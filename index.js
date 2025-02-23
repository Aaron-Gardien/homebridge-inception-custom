// Version 2.0 - Improved handling of empty poll responses and HTTP errors
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

            try {
                let parsedBody = JSON.parse(body);
                if (!Array.isArray(parsedBody) || parsedBody.length <= this.areaIndex) {
                    this.log('[ERROR] Invalid area index or missing areas in response:', parsedBody);
                    return;
                }
                this.areaId = parsedBody[this.areaIndex].ID;
                this.log(`[INFO] Selected Area ID: ${this.areaId}`);
                this.startLongPolling();
            } catch (parseError) {
                this.log('[ERROR] Failed to parse area list response:', parseError);
            }
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
            } else if (!body || body.trim() === "") {
                this.log('[WARNING] Poll request returned an empty response. Retrying...');
            } else {
                try {
                    let parsedBody = JSON.parse(body);
                    if (parsedBody.Updates) {
                        parsedBody.Updates.forEach(update => {
                            if (update.Type === 'AreaStateUpdate' && update.AreaId === this.areaId) {
                                this._updateHomeKitState(update.State);
                            }
                        });
                    }
                } catch (parseError) {
                    this.log('[ERROR] Failed to parse poll response:', parseError);
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
}
