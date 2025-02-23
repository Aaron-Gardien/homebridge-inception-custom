// Version 3.5 - Restored polling and alarm control functionality
const request = require('request');

let Service, Characteristic;

module.exports = (homebridge) => {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-inception-custom', 'InceptionAlarm', InceptionAccessory);
};

class InceptionAccessory {
    constructor(log, config) {
        if (!log || !config) {
            throw new Error("[FATAL] InceptionAccessory constructor missing required parameters: log or config.");
        }

        this.log = log;
        this.config = config;
        this.apiToken = config.apiToken;
        this.ipAddress = config.ipAddress;
        this.apiBaseUrl = `http://${this.ipAddress}/api/v1`;
        this.areaIndex = config.area;
        this.areaId = null;
        
        this.service = new Service.SecuritySystem(config.name);

        // Define all necessary methods before binding
        this.getAlarmState = this.getAlarmState.bind(this);
        this.setAlarmState = this.setAlarmState.bind(this);
        this.startLongPolling = this.startLongPolling.bind(this);
        this.pollState = this.pollState.bind(this);
        this.lookupAreaId = this.lookupAreaId.bind(this);
        this.updateHomeKitState = this.updateHomeKitState.bind(this);
        
        this.lookupAreaId();
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

    startLongPolling() {
        this.log('[INFO] Starting long polling for state updates...');
        this.pollState();
    }

    pollState() {
        if (!this.areaId) {
            this.log('[ERROR] Area ID not set. Cannot poll state.');
            return;
        }

        var options = {
            'method': 'POST',
            'url': `${this.apiBaseUrl}/monitor-updates`,
            'headers': {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`
            },
            'body': JSON.stringify([
                {
                    "ID": "AreaStateRequest",
                    "RequestType": "MonitorEntityStates",
                    "InputData": {
                        "stateType": "AreaState",
                        "timeSinceUpdate": "0"
                    }
                }
            ])
        };

        request(options, (error, response, body) => {
            if (error) {
                this.log('[ERROR] Failed to poll state:', error);
            } else if (response.statusCode !== 200) {
                this.log(`[ERROR] Polling request failed with status ${response.statusCode}:`, body);
            } else {
                try {
                    let parsedBody = JSON.parse(body);
                    if (parsedBody.Updates) {
                        parsedBody.Updates.forEach(update => {
                            if (update.Type === 'AreaStateUpdate' && update.AreaId === this.areaId) {
                                this.updateHomeKitState(update.State);
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

    updateHomeKitState(stateValue) {
        this.log(`[INFO] Updating HomeKit state to: ${stateValue}`);
        let homeKitState = Characteristic.SecuritySystemCurrentState.DISARMED;
        
        if (stateValue & 1) {
            homeKitState = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
        } else if (stateValue & 512) {
            homeKitState = Characteristic.SecuritySystemCurrentState.STAY_ARM;
        } else if (stateValue & 1024) {
            homeKitState = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
        } else if (stateValue & 2) {
            homeKitState = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
        }

        this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, homeKitState);
    }

    setAlarmState(value, callback) {
        if (!this.areaId) {
            this.log('[ERROR] Cannot change alarm state, area ID not set.');
            return callback(null);
        }

        let action = "Disarm";
        if (value === Characteristic.SecuritySystemTargetState.AWAY_ARM) {
            action = "Arm";
        } else if (value === Characteristic.SecuritySystemTargetState.STAY_ARM) {
            action = "StayArm";
        } else if (value === Characteristic.SecuritySystemTargetState.NIGHT_ARM) {
            action = "SleepArm";
        }

        var options = {
            'method': 'POST',
            'url': `${this.apiBaseUrl}/control/area/${this.areaId}/activity`,
            'headers': {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiToken}`
            },
            'body': JSON.stringify({
                "Type": "ControlArea",
                "AreaControlType": action
            })
        };

        request(options, (error, response, body) => {
            if (error) {
                this.log('[ERROR] Failed to change alarm state:', error);
            } else {
                this.log(`[INFO] Successfully set alarm state to: ${action}`);
            }
            callback(null);
        });
    }
}