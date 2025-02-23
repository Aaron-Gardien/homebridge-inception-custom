// index.js - Homebridge Plugin for Inner Range Inception (v4.0.4)
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
        this.fetchAreaId().then(() => this.monitorUpdates());
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
                let state = response.data.Armed ? Characteristic.SecuritySystemCurrentState.AWAY_ARM : Characteristic.SecuritySystemCurrentState.DISARMED;
                callback(null, state);
            } else {
                callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
            }
        } catch (error) {
            this.log("Error fetching alarm state:", error);
            callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
        }
    }

    async fetchAreaId() {
        if (!this.authToken) {
            this.log("No authentication token provided.");
            return;
        }
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

    async monitorUpdates() {
        if (!this.areaId) {
            this.log("Area ID not set, retrying in 5 seconds...");
            setTimeout(() => this.monitorUpdates(), 5000);
            return;
        }
        const requestBody = { Monitor: [{ Type: "AreaState", ID: this.areaId }] };
        try {
            const response = await axios.post(`${this.API_ROOT}/updates/monitor`, requestBody, {
                headers: { Authorization: `Bearer ${this.authToken}` },
                timeout: 60000,
                httpsAgent: this.httpsAgent
            });
            if (response.status === 200) {
                this.log("Received Update:", response.data);
                this.processUpdates(response.data);
            }
            this.monitorUpdates(); // Keep polling
        } catch (error) {
            this.log("Polling error:", error);
            setTimeout(() => this.monitorUpdates(), 5000); // Retry after delay
        }
    }

    processUpdates(updateData) {
        updateData.forEach(update => {
            if (update.Type === "AreaState" && update.ID === this.areaId) {
                let state = update.Armed ? Characteristic.SecuritySystemCurrentState.AWAY_ARM : Characteristic.SecuritySystemCurrentState.DISARMED;
                this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, state);
                this.log(`Alarm Area ${update.ID} State Updated:`, state);
            }
        });
    }

    getServices() {
        return [this.service];
    }
}
