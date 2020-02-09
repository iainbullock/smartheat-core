const moment = require('moment');
const Duration = require('durationjs');
const dateFormat = require('dateformat');
const Service = require('./Service');

class ThermostatService extends Service {
    constructor(logger, context, thermostatFactory, thermostatRepository, holdStrategy, setTemperatureStrategy) {
        super(logger, context, thermostatFactory, thermostatRepository);

        this._holdStrategy = holdStrategy;
        this._setTemperatureStrategy = setTemperatureStrategy;
    }

    async launch() {
        const client = await this.login();
        try {
            if (await client.online()) {
                return this.createResponse(['Thermostat is online.'], client);
            } else {
                return this.createResponse(['Sorry, the thermostat is offline at the moment.'], client);
            }
        } finally {
            await client.logout();
        }
    }

    async status() {
        this._logger.debug('Requesting status...');
        const client = await this.login();
        try {
            await this.verifyOnline(client);
            const device = await client.device();
            this.verifyContactable(device);

            const messages = [];
            messages.push(`The current temperature is ${this.speakTemperature(device.currentTemperature)} degrees.`);

            if (device.awayMode === 'home') {
              messages.push(`The target is ${this.speakTemperature(device.targetTemperature)} degrees.`);
            }

            await this.determineIfHolding(device, messages);

            if (device.awayMode === 'away') {
                    messages.push(`Away Mode is on.`);
            }

            this.logStatus(device);
            return this.createResponse(messages, client, {
                currentTemperature: device.currentTemperature,
                targetTemperature: device.targetTemperature
            });
        } finally {
            await client.logout();
        }
    }

    async time() {
        this._logger.debug('Requesting time...');
        const client = await this.login();
        try {
            await this.verifyOnline(client);
            const device = await client.device();
            this.verifyContactable(device);

            let formatted_device_time = dateFormat(device.time, "dddd dS mmmm, h MM TT");
            let timeDelta = (Date.parse(Date()) - device.time - 120000) / 60000;
            
            const messages = [];
            messages.push(`The device time is ${formatted_device_time}, which is ${timeDelta.toFixed(1)} minutes ${if (timeDelta < 0) ? 'fast' : 'slow'}`);

            this.logStatus(device);
            return this.createResponse(messages, client, {
                currentTemperature: device.currentTemperature
            });
        } finally {
            await client.logout();
        }
    }

    async determineIfHolding(device, messages, qualifier = '') {
        if (qualifier !== '') {
            qualifier = ` ${qualifier}`;
        }

        if (device.status !== 'on') {
            messages.push(`The heating is ${qualifier} off.`);
            return;
        }

        const status = await this._holdStrategy.status();
        this._logger.debug(status);
        if (status.status === 'running') {
            const timeSinceStart = (moment().diff(status.startDate) / 1000).toFixed(0);
            const durationSinceStart = new Duration(`PT${timeSinceStart}S`);
            const timeToGo = status.duration.subtract(durationSinceStart);
            messages.push(`The heating is ${qualifier} on and will turn off in ${this.speakDuration(timeToGo)}.`);
        } else {
            messages.push(`The heating is ${qualifier} on.`);
        }
    }

    async turnUp() {
        return this.adjustTemperature(1.0);
    }

    async turnDown() {
        return this.adjustTemperature(-1.0);
    }

    async turnOn(duration) {
        this._logger.debug('Turning heating on...');

        const thermostat = await this.obtainThermostat();
        let t = thermostat.defaultOnTemp;

        return this.setTemperature(t, duration, 'on');
    }

    async turnOff() {
        this._logger.debug('Turning heating off...');

        const thermostat = await this.obtainThermostat();
        let t = thermostat.defaultOffTemp;

        return this.setTemperature(t, null, 'off');
    }

    async setTemperature(targetTemperature, forDuration, onOff = 'undefined') {
        this._logger.debug(`Setting temperature to ${targetTemperature}...`);
        const client = await this.login();
        try {
            const device = await this.verifyDevice(client);
            let messages = [` `];
            let updatedDevice = '';
            const thermostat = await this.obtainThermostat();

            if (onOff === 'on' && (device.currentTemperature > targetTemperature) ) {
                targetTemperature = Math.trunc(parseFloat(device.currentTemperature)) + 1;
                this._logger.debug(`Updating requested temperature to ${targetTemperature}...`);
            }

            if (targetTemperature > thermostat.maxOnTemp) {
                this._logger.debug(`Limiting temperature to ${thermostat.maxOnTemp}...`);
                messages = messages.concat(`The maximum temperature is limited to ${thermostat.maxOnTemp} degrees.`);
                targetTemperature = thermostat.maxOnTemp;
            }

            if (onOff ==='on' && device.awayMode === 'away') {
                let updatedDevice2 = await this._setTemperatureStrategy.setAwayMode(client, 'home');
                updatedDevice = await this._setTemperatureStrategy.setTemperature(client, targetTemperature);
                messages = messages.concat(`The target temperature is now ${this.speakTemperature(updatedDevice.targetTemperature)} degrees.`);
                messages = messages.concat(`Away mode is now ${updatedDevice2.awayMode === 'away' ? 'on' : 'off'}.`);
            } else {
                updatedDevice = await this._setTemperatureStrategy.setTemperature(client, targetTemperature);
                messages = messages.concat(`The target temperature is now ${this.speakTemperature(updatedDevice.targetTemperature)} degrees.`);
            }

            this.logStatus(updatedDevice);

            if (this._context.source === 'user') {
                const thermostat = await this.obtainThermostat();
                if (onOff === 'on') {
                    const duration = forDuration || thermostat.defaultDuration;
                    const intent = await this._holdStrategy.holdIfRequiredFor(duration);
                    /** messages = messages.concat(this.summarize(duration, intent, updatedDevice)); **/
                } else {
                    await this._holdStrategy.stopHoldIfRequired(thermostat.executionId);
                }
            }

            let qualifier = 'now';
            if (device.status == updatedDevice.status) {
                qualifier = 'still';
            }

            await this.determineIfHolding(updatedDevice, messages, qualifier);

            return this.createResponse(messages, client, {
                targetTemperature: updatedDevice.targetTemperature,
                currentTemperature: updatedDevice.currentTemperature
            });
        } finally {
            await client.logout();
        }
    }

    async setAwayModeOff() {
        this._logger.debug('Turning Away Mode off...');

        return this.setAwayMode('home');
    }

    async setAwayModeOn() {
        this._logger.debug('Turning Away Mode on...');

        return this.setAwayMode('away');
    }

    async setAwayMode(mode) {
        this._logger.debug(`Setting Away Mode to ${mode}...`);
        const client = await this.login();
        try {
            await this.verifyDevice(client);

            let updatedDevice = await this._setTemperatureStrategy.setAwayMode(client, mode);

            let messages = [`Away mode is now ${updatedDevice.awayMode === 'away' ? 'on' : 'off'}.`];
            this.logStatus(updatedDevice);

            return this.createResponse(messages, client);
        } finally {
            await client.logout();
        }
    }

    /**
     * Verifies the client is online and can
     * connect to the device
     * @param {ThermostatClient} client
     */
    async verifyDevice(client) {
        await this.verifyOnline(client);
        const device = await client.device();
        this.verifyContactable(device);
        return device;
    }

    /**
     * Adjusts the temperature by the specified
     * signed number, eg +/-2 degrees
     * @param {number} tempDelta
     */
    async adjustTemperature(tempDelta) {
        this._logger.debug(`Adjusting temperature by ${tempDelta}...`);
        const client = await this.login();

        try {
            const device = await this.verifyDevice(client);
            const thermostat = await this.obtainThermostat();
            let messages = [` `];

            let t = device.targetTemperature + tempDelta;

            if (t > thermostat.maxOnTemp) {
                this._logger.debug(`Limiting temperature to ${thermostat.maxOnTemp}...`);
                messages = messages.concat(`The maximum temperature is limited to ${thermostat.maxOnTemp} degrees.`);
                t = thermostat.maxOnTemp;
            }

            let updatedDevice = await this._setTemperatureStrategy.setTemperature(client, t);

            messages = messages.concat(`The target temperature is now ${this.speakTemperature(updatedDevice.targetTemperature)} degrees.`);

            let qualifier = 'now';
            if (device.status == updatedDevice.status) {
                qualifier = 'still';
            }

            await this.determineIfHolding(updatedDevice, messages, qualifier);

            this.logStatus(device);
            return this.createResponse(messages, client, {
                targetTemperature: updatedDevice.targetTemperature,
                currentTemperature: updatedDevice.currentTemperature
            });
        } finally {
            await client.logout();
        }
    }

    summarize(duration, intent, updatedDevice) {
        if (!intent.holding) {
            const messages = [];
            if (duration) {
                messages.push('Hold time is not supported on this device.');
            }
            if (updatedDevice.status === 'on') {
                messages.push('The heating is now on.');
            }
            return messages;
        }

        const durationText = this.speakDuration(intent.duration);
        this._logger.debug(`Holding for ${durationText} {${intent.executionId}}`);
        if (updatedDevice.status === 'on') {
            return [`The heating is now on and will turn off in ${durationText}.`];
        }

        return [`The heating will turn off in ${durationText}.`];
    }

    async thermostatDetails() {
        this._logger.debug('Retrieving client details...');

        const thermostat = await this.obtainThermostat();
        const client = this._thermostatFactory.create(thermostat.type, thermostat.options);

        return {
            friendlyName: client.friendlyName,
            manufacturerName: client.manufacturerName,
            description: client.description,
            displayCategories: ['THERMOSTAT'],
            endpointId: thermostat.guid
        };
    }

    logStatus(device) {
        this._logger.debug(`${new Date().toISOString()} ${device.currentTemperature} => ${device.targetTemperature} (${device.status})`);
    }

    speakTemperature(temp) {
        if (parseFloat(temp.toFixed(0)) != temp) return temp.toFixed(1);
        else return temp.toFixed(0);
    }
}

module.exports = ThermostatService;
