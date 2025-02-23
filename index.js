// Version 1.4 - Refactored method binding using arrow functions to fix 'bind' issue
const request = require('request');

let Service, Characteristic;

module.exports = (homebridge) => {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-inception-custom', 'InceptionAlarm', InceptionAccessory);
};

class InceptionAccessory {
    constructor(log, config) {
        this.log = log;
        this.config = config;
        this.apiToken = config.apiToken;
        this.ipAddress = config.ipAddress;
        this.apiBaseUrl = `http://${this.ipAddress}/api/v1`;
        this.areaIndex = config.area; // Now stores an integer index
        this.areaId = null; // Will be determined dynamically
        
        this.service = new Service.SecuritySystem(config.name);
        
        // Using arrow functions to automatically bind methods
        this.getAlarmState = (callback) => this._getAlarmState(callback);
        this.setAlarmState = (value, callback) => this._setAlarmState(value, callback);
        this.lookupAreaId();

        this.service
            .getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .on('get', this.getAlarmState);
        
        this.service
            .getCharacteristic(Characteristic.SecuritySystemTargetState)
            .on('set', this.setAlarmState);
    }

    lookupAreaId() {
        this.log('[INFO] Looking up area ID...');
        var options = {
            'method': 'GET',
            'url': `${this.apiBaseUrl}/control/area`,
            'headers': {
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`
            }
        };

        request(options, (error, response, body) => {
            if (error) {
                this.log('[ERROR] Failed to fetch area list:', error);
                return;
            }

            let parsedBody = JSON.parse(body);
            if (!Array.isArray(parsedBody) || parsedBody.length <= this.areaIndex) {
                this.log('[ERROR] Invalid area index or missing areas in response:', parsedBody);
                return;
            }

            this.areaId = parsedBody[this.areaIndex].ID;
            this.log(`[INFO] Selected Area ID: ${this.areaId}`);
            this.startLongPolling();
        });
    }

    _getAlarmState(callback) {
        if (!this.areaId) {
            this.log('[ERROR] Area ID not set. Cannot fetch alarm state.');
            return callback(new Error('Area ID not available'));
        }

        var options = {
            'method': 'GET',
            'url': `${this.apiBaseUrl}/control/area/${this.areaId}/state`,
            'headers': {
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`
            }
        };

        request(options, (error, response, body) => {
            if (error) {
                this.log('[ERROR] Failed to fetch alarm state:', error);
                return callback(error);
            }
            
            let parsedBody = JSON.parse(body);
            const stateValue = parsedBody.State;
            const isArmed = stateValue & 1;
            const homekitState = isArmed ? Characteristic.SecuritySystemCurrentState.AWAY_ARM : Characteristic.SecuritySystemCurrentState.DISARMED;

            this.log(`[INFO] Alarm state: ${isArmed ? 'Armed' : 'Disarmed'}`);
            callback(null, homekitState);
        });
    }

    _setAlarmState(value, callback) {
        if (!this.areaId) {
            this.log('[ERROR] Area ID not set. Cannot set alarm state.');
            return callback(new Error('Area ID not available'));
        }

        const armType = value === Characteristic.SecuritySystemTargetState.AWAY_ARM ? "AwayArm"
                        : value === Characteristic.SecuritySystemTargetState.STAY_ARM ? "StayArm"
                        : value === Characteristic.SecuritySystemTargetState.NIGHT_ARM ? "SleepArm"
                        : "Disarm";

        var options = {
            'method': 'POST',
            'url': `${this.apiBaseUrl}/control/area/${this.areaId}/activity`,
            'headers': {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`
            },
            body: JSON.stringify({
                "Type": "ControlArea",
                "AreaControlType": armType
            })
        };

        request(options, (error, response, body) => {
            if (error) {
                this.log('[ERROR] Error setting alarm state:', error);
                return callback(error);
            }
            this.log(`[INFO] Successfully set alarm state to: ${armType}`);
            callback(null);
        });
    }
}
