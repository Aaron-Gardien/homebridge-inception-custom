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
        this.log('[WARNING] No authentication token. Attempting to authenticate...');
        return this.authenticate((err) => {
            if (err) {
                return callback(err);
            }
            this.getAlarmState(callback); // Retry after authentication
        });
    }

    var options = {
        'method': 'GET',
        'url': this.apiBaseUrl + '/control/area',
        'headers': {
            'Accept': 'application/json',
            'X-User-ID': this.authToken  // Pass UserID as authentication
        }
    };

    request(options, (error, response, body) => {
        if (error) {
            this.log('[ERROR] Failed to fetch alarm state:', error);
            return callback(error);
        }

        let parsedBody;
        try {
            parsedBody = JSON.parse(body);
        } catch (e) {
            this.log('[ERROR] Failed to parse API response:', e);
            return callback(new Error('Invalid API response'));
        }

        if (!parsedBody.Areas || !Array.isArray(parsedBody.Areas) || parsedBody.Areas.length === 0) {
            this.log('[ERROR] Unexpected API response format: Missing Areas');
            return callback(new Error('Invalid API response format'));
        }

        const isArmed = parsedBody.Areas[0].Armed;
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
  if (!this.authToken) {
      this.log('[WARNING] No authentication token. Attempting to authenticate...');
      return this.authenticate((err) => {
          if (err) {
              return callback(err);
          }
          this.setAlarmState(value, callback); // Retry after authentication
      });
  }

  const arm = value === Characteristic.SecuritySystemTargetState.AWAY_ARM;
  var options = {
      'method': 'POST',
      'url': this.apiBaseUrl + `/control/area/${this.config.areaId}/activity`,
      'headers': {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'X-User-ID': this.authToken // Use UserID for authentication
      },
      body: JSON.stringify({
          "Type": "ControlArea",
          "AreaControlType": arm ? "Arm" : "Disarm"
      })
  };

  request(options, (error, response, body) => {
      if (error) {
          this.log('[ERROR] Error setting alarm state:', error);
          return callback(error);
      }

      let parsedBody;
      try {
          parsedBody = JSON.parse(body);
      } catch (e) {
          this.log('[ERROR] Failed to parse API response:', e);
          return callback(new Error('Invalid API response'));
      }

      if (parsedBody.Response.Result !== 'Success') {
          this.log(`[ERROR] API error: ${parsedBody.Response.Message}`);
          return callback(new Error('Failed to update alarm state'));
      }

      this.log(`[INFO] Successfully set alarm state to: ${arm ? 'Armed' : 'Disarmed'}`);
      callback(null);
  });
}


  authenticate(callback) {
    if (this.authToken) {
        this.log('[INFO] Reusing existing UserID.');
        return callback(null);
    }

    this.log('[INFO] Authenticating with Inception API...');

    var options = {
        'method': 'POST',
        'url': this.apiBaseUrl + '/authentication/login',
        'headers': {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            "Username": this.config.username,
            "Password": this.config.password
        })
    };

    request(options, (error, response) => {
        if (error) {
            this.log('[ERROR] Authentication request failed:', error);
            return callback(error);
        }

        let temp = JSON.parse(response.body);
        if (!temp.UserID) {
            this.log('[ERROR] No UserID received from API!');
            return callback(new Error('No UserID received from API'));
        }

        this.authToken = temp.UserID;
        this.log(`[INFO] Authentication successful! UserID: ${this.authToken}`);
        callback(null);
    });
}






  getServices() {
    return [this.service];
  }
}
