const axios = require('axios');
const https = require('https');

module.exports = (homebridge) => {
    homebridge.registerAccessory('homebridge-inception-custom', 'InceptionAlarm', InceptionAlarmAccessory);
    const { Service, Characteristic } = homebridge.hap;
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
                timeout: 60000,
                httpsAgent: this.httpsAgent
            });
            
            if (response.status === 200) {
                this.log("Received Update:", response.data);
                this.processUpdates(response.data);
            }
            this.monitorUpdates();
        } catch (error) {
            this.log("Polling error:", error.message);
            setTimeout(() => this.monitorUpdates(), 5000);
        }
    }

    processUpdates(updateData) {
        if (!updateData || !updateData.Result || !updateData.Result.stateData) return;
        
        updateData.Result.stateData.forEach(update => {
            if (update.ID === this.areaId) {
                this.log(`Received PublicState (Base10): ${update.PublicState}, Binary: ${update.PublicState.toString(2)}`);
                let state = this.mapStateValue(update.PublicState);
                this.service.updateCharacteristic(Characteristic.SecuritySystemCurrentState, state);
                this.log(`Alarm Area ${update.ID} State Updated:`, state);
            }
        });
    }

    mapStateValue(stateValue) {
        this.log(`Decoding state value: ${stateValue} (Binary: ${stateValue.toString(2)})`);
        
        let state = Characteristic.SecuritySystemCurrentState.DISARMED;
        if (stateValue & 0x00000001) state = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
        if (stateValue & 0x00000002) state = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
        if (stateValue & 0x00000004) this.log('Entry Delay Active');
        if (stateValue & 0x00000008) this.log('Exit Delay Active');
        if (stateValue & 0x00000010) this.log('Arm Warning Active');
        if (stateValue & 0x00000020) this.log('Defer Disarmed Active');
        if (stateValue & 0x00000040) this.log('Detecting Active Inputs');
        if (stateValue & 0x00000080) this.log('Walk Test Active');
        if (stateValue & 0x00000100) state = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
        if (stateValue & 0x00000200) state = Characteristic.SecuritySystemCurrentState.STAY_ARM;
        if (stateValue & 0x00000400) state = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
        if (stateValue & 0x00000800) state = Characteristic.SecuritySystemCurrentState.DISARMED;
        if (stateValue & 0x00001000) this.log('Arm Ready');
        return state;
    }

    getServices() {
        return [this.service];
    }
}
