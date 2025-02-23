// index.js - Homebridge Plugin for Inner Range Inception (v4.1.3)
const axios = require('axios');
const https = require('https');
const homebridgeLib = require('homebridge-lib');

module.exports = (homebridge) => {
    homebridge.registerAccessory('homebridge-inception-custom', 'InceptionAlarm', InceptionAlarmAccessory);
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
};

class InceptionAlarmAccessory {
    constructor(log, config) {
        this.log = log;
        this.name = config.name || 'Inception Alarm';
        this.authToken = config.authToken;
        this.areaName = config.areaName;
        this.ipAddress = config.ipAddress;
        this.areaId = null;
        this.API_ROOT = `https://${this.ipAddress}/api/v1`;
        this.httpsAgent = new https.Agent({ rejectUnauthorized: false }); // Ignore self-signed cert errors
        this.service = new Service.SecuritySystem(this.name);
        this.service
            .getCharacteristic(Characteristic.SecuritySystemCurrentState)
            .on('get', this.getAlarmState.bind(this));
        this.fetchAreaId().then(() => this.monitorUpdates()).catch(error => this.log("Error fetching area ID:", error));
    }

    async fetchAreaId() {
        try {
            const response = await axios.get(`${this.API_ROOT}/control/area`, {
                headers: { Authorization: `Bearer ${this.authToken}` },
                httpsAgent: this.httpsAgent
            });
            if (response.status === 200 && response.data.length > 0) {
                const area = response.data.find(area => area.Name === this.areaName);
                if (area) {
                    this.areaId = area.ID;
                    this.log(`Resolved area name '${this.areaName}' to ID '${this.areaId}'`);
                } else {
                    this.log(`Area with name '${this.areaName}' not found.`);
                }
            }
        } catch (error) {
            this.log("Error fetching area ID:", error);
        }
    }

    async getAlarmState(callback) {
        if (!this.areaId) {
            callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
            return;
        }
        try {
            const response = await axios.get(`${this.API_ROOT}/control/area/${this.areaId}/state`, {
                headers: { Authorization: `Bearer ${this.authToken}` },
                httpsAgent: this.httpsAgent
            });
            if (response.status === 200) {
                let state = this.mapStateValue(response.data.stateValue);
                callback(null, state);
            } else {
                callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
            }
        } catch (error) {
            this.log("Error fetching alarm state:", error);
            callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
        }
    }

    async monitorUpdates() {
        if (!this.areaId) {
            this.log("Area ID not set, retrying in 5 seconds...");
            setTimeout(() => this.monitorUpdates(), 5000);
            return;
        }
        
        const requestBody = [
            {
                "ID": "MonitorAreaStates",
                "RequestType": "MonitorEntityStates",
                "InputData": {
                    "stateType": "AreaState",
                    "timeSinceUpdate": "0"
                }
            }
        ];
        
        this.log("Sending Monitor Request to: ", `${this.API_ROOT}/monitor-updates`);
        this.log("Request Body:", JSON.stringify(requestBody));
        
        try {
            const response = await axios.post(`${this.API_ROOT}/monitor-updates`, requestBody, {
                headers: { Authorization: `Bearer ${this.authToken}` },
                timeout: 60000, // Long polling waits up to 60 seconds
                httpsAgent: this.httpsAgent
            });
            
            if (response.status === 200) {
                this.log("Received Update:", response.data);
                this.processUpdates(response.data);
            }
            // Immediately call monitorUpdates again to maintain long polling
            setImmediate(() => this.monitorUpdates());
        } catch (error) {
            this.log("Polling error (HTTP Status: ", error.response?.status, " - ", error.response?.statusText, "):", error.message);
            if (error.response) {
                this.log("Response Headers:", JSON.stringify(error.response.headers));
                this.log("Response Data:", JSON.stringify(error.response.data));
            }
            // Wait a bit before retrying to prevent rapid loops
            setTimeout(() => this.monitorUpdates(), 5000);
        }
    }

    processUpdates(updateData) {
        if (!updateData || !updateData.Result || !updateData.Result.stateData) return;
        
        updateData.Result.stateData.forEach(update => {
            if (update.ID === this.areaId) {
                let state = this.mapStateValue(update.stateValue);
                this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, state);
                this.log(`Alarm Area ${update.ID} State Updated:`, state);
            }
        });
    }

    mapStateValue(stateValue) {
        let state = Characteristic.SecuritySystemCurrentState.DISARMED;
        if (stateValue & 0x00000200) state = Characteristic.SecuritySystemCurrentState.STAY_ARM; // Perimeter mode
        if (stateValue & 0x00000400) state = Characteristic.SecuritySystemCurrentState.NIGHT_ARM; // Night mode
        if (stateValue & 0x00000100) state = Characteristic.SecuritySystemCurrentState.AWAY_ARM; // Full mode
        if (stateValue & 0x00000002) state = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED; // Alarm active
        return state;
    }

    getServices() {
        return [this.service];
    }
}
