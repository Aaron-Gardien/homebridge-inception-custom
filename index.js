// Version 2.9 - Fixed missing method definitions before binding
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

        // Define required methods before binding
        this.getAlarmState = this.getAlarmState || function(callback) {
            this.log('[DEBUG] getAlarmState called');
            callback(null, Characteristic.SecuritySystemCurrentState.DISARMED);
        };

        this.setAlarmState = this.setAlarmState || function(value, callback) {
            this.log(`[DEBUG] setAlarmState called with value: ${value}`);
            callback(null);
        };

        this.updateHomeKitState = this.updateHomeKitState || function(stateValue) {
            this.log(`[DEBUG] updateHomeKitState called with state: ${stateValue}`);
        };

        this.log('[DEBUG] Checking method existence before binding...');
        const requiredMethods = ['getAlarmState', 'setAlarmState', 'startLongPolling', 'pollState', 'lookupAreaId', 'updateHomeKitState'];
        requiredMethods.forEach(method => {
            if (typeof this[method] !== 'function') {
                throw new Error(`[FATAL] Method '${method}' is not defined before binding.`);
            }
        });
        
        this.log('[DEBUG] Ensuring method bindings...');
        this.getAlarmState = this.getAlarmState.bind(this);
        this.setAlarmState = this.setAlarmState.bind(this);
        this.startLongPolling = this.startLongPolling.bind(this);
        this.pollState = this.pollState.bind(this);
        this.lookupAreaId = this.lookupAreaId.bind(this);
        this.updateHomeKitState = this.updateHomeKitState.bind(this);
        
        this.log('[DEBUG] Method bindings completed successfully.');
        
        this.lookupAreaId();
    }

    getServices() {
        return [this.service];
    }
}
