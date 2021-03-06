class Logger {
    constructor(level = Logger.OFF, destination = console) {
        this.level = level;
        this._destination = destination;
        this._prefix = '';
    }

    set level(level) {
        switch (level) {
        case 'OFF':
            this._level = Logger.OFF;
            break;
        case 'DEBUG':
            this._level = Logger.DEBUG;
            break;
        case 'INFO':
            this._level = Logger.INFO;
            break;
        case 'WARNING':
            this._level = Logger.WARNING;
            break;
        case 'ERROR':
            this._level = Logger.ERROR;
            break;
        default:
            this._level = level;
            break;
        }
    }

    set prefix(prefix) {
        this._prefix = prefix;
    }

    debug(message) {
        this.log(message, Logger.DEBUG);
    }

    info(message) {
        this.log(message, Logger.INFO);
    }

    warning(message) {
        this.log(message, Logger.WARNING);
    }

    error(message) {
        this.log(message, Logger.ERROR);
    }

    log(message, level) {
        if (level <= this._level) {
            if (this._prefix === '') {
                this._destination.log(message);
            } else {
                this._destination.log(`${this._prefix}: ${message}`);
            }
        }
    }
}

Logger.OFF = 0;
Logger.DEBUG = 4;
Logger.INFO = 3;
Logger.WARNING = 2;
Logger.ERROR = 1;

Object.freeze(Logger.OFF);
Object.freeze(Logger.DEBUG);
Object.freeze(Logger.INFO);
Object.freeze(Logger.WARNING);
Object.freeze(Logger.ERROR);

module.exports = Logger;