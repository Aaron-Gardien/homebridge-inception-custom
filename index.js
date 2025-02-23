const request = require('request');

let Service, Characteristic;

module.exports = (homebridge) => {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-inception', 'InceptionAlarm', InceptionAccessory);
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
        this.service
            .getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .on('get', this.getAlarmState.bind(this));
        
        this.service
            .getCharacteristic(Characteristic.SecuritySystemTargetState)
            .on('set', this.setAlarmState.bind(this));

        // Lookup and set the area ID before polling starts
        this.lookupAreaId();
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

    startLongPolling() {
        if (!this.areaId) {
            this.log('[ERROR] Area ID not set. Cannot start polling.');
            return;
        }
        this.log('[INFO] Starting long polling for state updates...');
        this.pollState();
    }

    pollState() {
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
                this.handlePollResponse(body);
            }
            
            // Continue polling after a short delay
            setTimeout(() => this.pollState(), 5000);
        });
    }

    handlePollResponse(body) {
        try {
            let parsedBody = JSON.parse(body);
            if (!parsedBody || !parsedBody.Updates) {
                this.log('[WARNING] Polling response did not contain valid updates:', body);
                return;
            }

            parsedBody.Updates.forEach(update => {
                if (update.Type === 'AreaStateUpdate' && update.AreaId === this.areaId) {
                    const isArmed = update.State & 1;
                    this.log(`Area ${this.areaId} is now ${isArmed ? 'Armed' : 'Disarmed'}.`);
                    this.service
                        .getCharacteristic(Characteristic.SecuritySystemCurrentState)
                        .updateValue(isArmed ? Characteristic.SecuritySystemCurrentState.AWAY_ARM : Characteristic.SecuritySystemCurrentState.DISARMED);
                }
            });
        } catch (error) {
            this.log('[ERROR] Failed to parse polling response:', error);
        }
    }

    getAlarmState(callback) {
        if (!this.areaId) {
            this.log('[ERROR] Area ID not set. Cannot fetch state.');
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

    getServices() {
        return [this.service];
    }
}
