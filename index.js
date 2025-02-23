// Version 1.8 - Added handling for active alarm state in HomeKit
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
        this.areaIndex = config.area;
        this.areaId = null;
        
        this.service = new Service.SecuritySystem(config.name);
        
        this.getAlarmState = (callback) => this._getAlarmState(callback);
        this.setAlarmState = (value, callback) => this._setAlarmState(value, callback);
        this.startLongPolling = () => this._startLongPolling();
        this.lookupAreaId();

        this.service
            .getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .on('get', this.getAlarmState);
        
        this.service
            .getCharacteristic(Characteristic.SecuritySystemTargetState)
            .on('set', this.setAlarmState);
    }

    getServices() {
        return [this.service];
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

    _startLongPolling() {
        this.log('[INFO] Starting long polling for state updates...');
        this.pollState();
    }

    pollState() {
        if (!this.areaId) {
            this.log('[ERROR] Area ID not set. Cannot poll state.');
            return;
        }

        var options = {
            'method': 'GET',
            'url': `${this.apiBaseUrl}/monitor-updates/poll`,
            'headers': {
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`
            }
        };

        request(options, (error, response, body) => {
            if (error) {
                this.log('[ERROR] Failed to poll state:', error);
            } else {
                let parsedBody = JSON.parse(body);
                if (parsedBody.Updates) {
                    parsedBody.Updates.forEach(update => {
                        if (update.Type === 'AreaStateUpdate' && update.AreaId === this.areaId) {
                            this._updateHomeKitState(update.State);
                        }
                    });
                }
            }
            setTimeout(() => this.pollState(), 5000);
        });
    }

    _updateHomeKitState(stateValue) {
        const isArmed = stateValue & 1;
        const isAlarm = stateValue & 2; // 0x00000002 - Area is in alarm
        const isStayArm = stateValue & 512;
        const isNightArm = stateValue & 1024;
        const isDisarmed = stateValue & 2048;

        let homekitState = Characteristic.SecuritySystemCurrentState.DISARMED;
        if (isAlarm) {
            homekitState = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
        } else if (isNightArm) {
            homekitState = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
        } else if (isStayArm) {
            homekitState = Characteristic.SecuritySystemCurrentState.STAY_ARM;
        } else if (isArmed) {
            homekitState = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
        }

        this.log(`[INFO] Updating HomeKit state to: ${homekitState}`);
        this.service
            .getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .updateValue(homekitState);
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
            this._updateHomeKitState(parsedBody.State);
            callback(null);
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
