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
    this.apiBaseUrl = config.apiBaseUrl;
    this.authToken = null;

    this.service = new Service.SecuritySystem(config.name);
    this.service
      .getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .on('get', this.getAlarmState.bind(this));
    
    this.service
      .getCharacteristic(Characteristic.SecuritySystemTargetState)
      .on('set', this.setAlarmState.bind(this));
  }

  getAlarmState(callback) {
    if (!this.authToken) {
      this.log('No authentication token. Attempting to re-authenticate...');
      return this.authenticate(() => this.getAlarmState(callback));
    }

    request.get({
      url: `${this.apiBaseUrl}/control/area`,
      headers: { Cookie: `LoginSessId=${this.authToken}` },
      json: true
    }, (error, response, body) => {
      if (error || response.statusCode !== 200 || !body) {
        this.log('[ERROR] Failed to fetch alarm state:', error || response.statusCode);
        return callback(error || new Error('Invalid response from API'));
      }

      // Debugging: Log the full API response
      this.log('[DEBUG] API Response:', JSON.stringify(body, null, 2));

      if (!body.Areas || !Array.isArray(body.Areas) || body.Areas.length === 0) {
        this.log('[ERROR] Unexpected API response format: Missing Areas');
        return callback(new Error('Invalid API response format'));
      }

      const isArmed = body.Areas[0].Armed;

      if (typeof isArmed !== 'boolean') {
        this.log('[ERROR] Missing "Armed" status in API response.');
        return callback(new Error('Missing Armed status in API response'));
      }

      // Convert boolean to HomeKit security state
      const state = isArmed
        ? Characteristic.SecuritySystemCurrentState.AWAY_ARM
        : Characteristic.SecuritySystemCurrentState.DISARMED;

      this.log(`[INFO] Alarm state: ${isArmed ? 'Armed' : 'Disarmed'}`);
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

  getServices() {
    return [this.service];
  }
}
