const request = require('request');
const { API, AccessoryPlugin, Service, Characteristic } = require('homebridge');

class InceptionAccessory {
  constructor(log, config) {
    this.log = log;
    this.config = config;
    this.apiBaseUrl = config.apiBaseUrl;
    this.authToken = config.authToken;

    this.service = new Service.SecuritySystem(config.name);
    this.service
      .getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .on('get', this.getAlarmState.bind(this));
    
    this.service
      .getCharacteristic(Characteristic.SecuritySystemTargetState)
      .on('set', this.setAlarmState.bind(this));
  }

  authenticate(callback) {
    const options = {
      url: `${this.apiBaseUrl}/authentication/login`,
      method: 'POST',
      json: {
        Username: this.config.username,
        Password: this.config.password
      }
    };
    request(options, (error, response, body) => {
      if (error || response.statusCode !== 200) {
        this.log('Authentication failed', error);
        return callback(error);
      }
      this.authToken = body.session_id;
      callback(null);
    });
  }

  getAlarmState(callback) {
    request.get({
      url: `${this.apiBaseUrl}/control/area`,
      headers: { Cookie: `LoginSessId=${this.authToken}` },
      json: true
    }, (error, response, body) => {
      if (error || response.statusCode !== 200) {
        this.log('Error fetching alarm state', error);
        return callback(error);
      }
      const state = body.Areas[0].Armed ? Characteristic.SecuritySystemCurrentState.AWAY_ARM : Characteristic.SecuritySystemCurrentState.DISARMED;
      callback(null, state);
    });
  }

  setAlarmState(value, callback) {
    const arm = value === Characteristic.SecuritySystemTargetState.AWAY_ARM;
    request.post({
      url: `${this.apiBaseUrl}/control/area/${this.config.areaId}/activity`,
      headers: { Cookie: `LoginSessId=${this.authToken}` },
      json: { Type: 'ControlArea', AreaControlType: arm ? 'Arm' : 'Disarm' }
    }, (error, response) => {
      if (error || response.statusCode !== 200) {
        this.log('Error setting alarm state', error);
        return callback(error);
      }
      callback(null);
    });
  }

  getServices() {
    return [this.service];
  }
}

module.exports = (homebridge) => {
  homebridge.registerAccessory('homebridge-inception', 'InceptionAlarm', InceptionAccessory);
};
