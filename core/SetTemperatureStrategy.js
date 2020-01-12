/**
 * Sets the temperature immediately
 */
class SetTemperatureStrategy {
    constructor(logger) {
        this._logger = logger;
    }

    async setTemperature(client, temperature) {
        await client.setTemperature(temperature);
        const updatedDevice = await client.device();
        return updatedDevice;
    }
    
    async setAwayMode(client, mode) {
        await client.setAwayMode(mode);
        const updatedDevice = await client.device();
        return updatedDevice;
    }
}

module.exports = SetTemperatureStrategy;
