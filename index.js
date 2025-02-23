// index.js - Homebridge Plugin for Inner Range Inception (v4.0.1)
const axios = require('axios');
const homebridgeLib = require('homebridge-lib');

module.exports = (homebridge) => {
    homebridge.registerAccessory('homebridge-inception-custom', 'InceptionAlarm', InceptionAlarmAccessory);
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
        this.service = new homebridgeLib.Service.SecuritySystem(this.name);
        this.service
            .getCharacteristic(homebridgeLib.Characteristic.SecuritySystemCurrentState)
            .on('get', this.getAlarmState.bind(this));
        this.fetchAreaId().then(() => this.monitorUpdates());
    }

    async fetchAreaId() {
        if (!this.authToken) {
            this.log("No authentication token provided.");
            return;
        }
        try {
            const response = await axios.get(`${this.API_ROOT}/control/area`, {
                headers: { Authorization: `Bearer ${this.authToken}` }
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
                timeout: 60000
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
                let state = update.Armed ? homebridgeLib.Characteristic.SecuritySystemCurrentState.AWAY_ARM : homebridgeLib.Characteristic.SecuritySystemCurrentState.DISARMED;
                this.service.updateCharacteristic(homebridgeLib.Characteristic.SecuritySystemCurrentState, state);
                this.log(`Alarm Area ${update.ID} State Updated:`, state);
            }
        });
    }

    getServices() {
        return [this.service];
    }
}
