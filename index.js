const WebSocket = require('ws');
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
        this.apiBaseUrl = config.apiBaseUrl;
        this.areaId = config.areaId;
        this.ws = null;
        
        this.service = new Service.SecuritySystem(config.name);
        this.service
            .getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .on('get', this.getAlarmState.bind(this));
        
        this.service
            .getCharacteristic(Characteristic.SecuritySystemTargetState)
            .on('set', this.setAlarmState.bind(this));

        // Initialize WebSocket connection
        this.initWebSocket();
    }

    initWebSocket() {
        const wsUrl = `${this.config.apiBaseUrl.replace('http', 'ws')}/api/v1/monitor-updates`;
        this.ws = new WebSocket(wsUrl, {
            headers: {
                'Authorization': `Bearer ${this.apiToken}`
            }
        });

        this.ws.on('open', () => {
            this.log('WebSocket connection established.');
            const monitorRequest = {
                Type: 'UpdateMonitorRequest',
                Areas: [this.areaId]
            };
            this.ws.send(JSON.stringify(monitorRequest));
        });

        this.ws.on('message', (data) => {
            this.handleWebSocketMessage(data);
        });

        this.ws.on('error', (error) => {
            this.log('WebSocket error:', error);
        });

        this.ws.on('close', () => {
            this.log('WebSocket connection closed. Reconnecting in 5 seconds...');
            setTimeout(() => this.initWebSocket(), 5000);
        });
    }

    handleWebSocketMessage(data) {
        try {
            const message = JSON.parse(data);
            if (message.Type === 'AreaStateUpdate' && message.AreaId === this.areaId) {
                const isArmed = message.State & 1;
                this.log(`Area ${this.areaId} is now ${isArmed ? 'Armed' : 'Disarmed'}.`);
                this.service
                    .getCharacteristic(Characteristic.SecuritySystemCurrentState)
                    .updateValue(isArmed ? Characteristic.SecuritySystemCurrentState.AWAY_ARM : Characteristic.SecuritySystemCurrentState.DISARMED);
            }
        } catch (error) {
            this.log('Error parsing WebSocket message:', error);
        }
    }

    getAlarmState(callback) {
        var options = {
            'method': 'GET',
            'url': `${this.config.apiBaseUrl}/api/v1/control/area/${this.areaId}/state`,
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

    setAlarmState(value, callback) {
        const armType = value === Characteristic.SecuritySystemTargetState.AWAY_ARM ? "AwayArm"
                        : value === Characteristic.SecuritySystemTargetState.STAY_ARM ? "StayArm"
                        : value === Characteristic.SecuritySystemTargetState.NIGHT_ARM ? "SleepArm"
                        : "Disarm";

        var options = {
            'method': 'POST',
            'url': `${this.config.apiBaseUrl}/api/v1/control/area/${this.areaId}/activity`,
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

    getServices() {
        return [this.service];
    }
}
