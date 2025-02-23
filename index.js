// Version 2.6 - Added detailed logging for method binding issues
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
        
        try {
            // Ensure method bindings
            this.log('[DEBUG] Binding class methods...');
            this.getAlarmState = this.getAlarmState.bind(this);
            this.setAlarmState = this.setAlarmState.bind(this);
            this.startLongPolling = this.startLongPolling.bind(this);
            this.pollState = this.pollState.bind(this);
            this.lookupAreaId = this.lookupAreaId.bind(this);
            this.updateHomeKitState = this.updateHomeKitState.bind(this);
            this.log('[DEBUG] Method bindings successful.');
        } catch (bindingError) {
            this.log('[ERROR] Failed to bind methods:', bindingError);
        }

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
                },
                {
                    "ID": "InputStateRequest",
                    "RequestType": "MonitorEntityStates",
                    "InputData": {
                        "stateType": "InputState",
                        "timeSinceUpdate": "0"
                    }
                },
                {
                    "ID": "OutputStateRequest",
                    "RequestType": "MonitorEntityStates",
                    "InputData": {
                        "stateType": "OutputState",
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
            } else if (!body || body.trim() === "") {
                this.log('[WARNING] Poll request returned an empty response. Retrying...');
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
}
