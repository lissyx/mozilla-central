/* Copyright 2012 Mozilla Foundation and Mozilla contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";

#filter substitution

#ifndef MOZ_MULET
const Cu = Components.utils;
#endif

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Timer.jsm");

Services.scriptloader.loadSubScript("resource://gre/modules/ril_consts.js", this);

const COMMAND_INCOMING_CALL = 0;
const PREF_RIL_LIBRILJS_SLOT = "ril.libriljs.slots.";
const NS_PREFBRANCH_PREFCHANGE_TOPIC_ID = "nsPref:changed";

function getRandomInt(min, max) {
  return Math.round(Math.random() * (max - min + 1)) + min;
}

function ReadOnlyBuffer(data) {
  this.data = data;
}
ReadOnlyBuffer.prototype = {
  readInt32BigIndian: function rob_readInt32BigIndian() {
    return this.data.shift() << 24 | this.data.shift() << 16 |
           this.data.shift() << 8  | this.data.shift();
  },

  readInt32: function rob_readInt32() {
    return this.data.shift()       | this.data.shift() << 8  |
           this.data.shift() << 16 | this.data.shift() << 24;
  },

  readUint16: function rob_readUint16() {
    return this.data.shift() | this.data.shift() << 8;
  },

  readString: function rob_readString() {
    let string_len = this.readInt32();
    if (string_len < 0 || string_len >= this.INT32_MAX) {
      return null;
    }
    let s = "";
    for (let i = 0; i < string_len; i++) {
      s += String.fromCharCode(this.readUint16());
    }
    // Strings are \0\0 delimited, but that isn"t part of the length. And
    // if the string length is even, the delimiter is two characters wide.
    // It"s insane, I know.
    this.readStringDelimiter(string_len);
    return s;
  },

  readStringDelimiter: function(length) {
    let delimiter = this.readUint16();
    if (!(length & 1)) {
      delimiter |= this.readUint16();
    }
  },

  count: function rob_count() {
    return this.data.length;
  }
};

function WriteOnlyBuffer() {
  this.data = [];
}
WriteOnlyBuffer.prototype = {
  writeInt32: function wob_writeInt32() {
    for (let i = 0; i < arguments.length; i++) {
      let number = arguments[i];
      this.data.push((number & 0xFF), (number >> 8) & 0xFF,
                     (number >> 16) & 0xFF, (number >> 24) & 0xFF);
    }
  },

  writeInt32List: function wob_writeInt32(ints) {
    for (let i = 0; i < ints.length; i++) {
      this.writeInt32(ints[i]);
    }
  },

  writeUint16: function wob_writeUint16() {
    for (let i = 0; i < arguments.length; i++) {
      let number = arguments[i];
      this.data.push((number & 0xFF), (number >> 8) & 0xFF);
    }
  },

  writeString: function wob_writeString(string) {
    this.writeInt32(string.length);
    for (let i = 0; i < string.length; i++) {
      this.writeUint16(string.charCodeAt(i));
    }
    // Strings are \0\0 delimited, but that isn"t part of the length. And
    // if the string length is even, the delimiter is two characters wide.
    // It"s insane, I know.
    this.writeStringDelimiter(string.length);
  },

  writeStringList: function wob_writeStringList(strings) {
    this.writeInt32(strings.length);
    for (let i = 0; i < strings.length; i++) {
      this.writeString(strings[i]);
    }
  },

  writeStringDelimiter: function(length) {
    this.writeUint16(0);
    if (!(length & 1)) {
      this.writeUint16(0);
    }
  },

  finalize: function wob_finalize() {
    let number = this.data.length;
    this.data.unshift((number >> 24) & 0xFF, (number >> 16) & 0xFF,
                      (number >> 8) & 0xFF, (number & 0xFF));
  }
};

function Calls(id, context) {
  this.id = id;
  this.context = context;
}

Calls.prototype = {
  _calls: [],

  start: function(number, state) {
    let connectionIndex = 1;
    this.forEach(function getLastIndex(call) {
      if (call.index >= connectionIndex) {
        connectionIndex = call.index + 1;
      }
    });

    let call = {
      number: number,
      state: state,
      index: connectionIndex,
      isMpty: 0
    };

    this._calls.push(call);

    setTimeout((function onNewCall() {
      call.state = state;
      this.context.sendUnsolicitedCallStateChanged();
    }).bind(this));

    if (state === CALL_STATE_DIALING) {
      setTimeout((function updateCallStateDialing() {
        call.state = CALL_STATE_ALERTING;
        this.context.sendUnsolicitedCallStateChanged();
      }).bind(this), 1000);

      setTimeout((function updateCallStateActive() {
        call.state = CALL_STATE_ACTIVE;
        this.context.sendUnsolicitedCallStateChanged();
      }).bind(this), 3000);
    }
  },

  stop: function(index, cause) {
    let calls = this._calls;

    this.forEach(function(call, i) {
      if (call.index == index ||
         (index === 0 && call.state === CALL_STATE_INCOMING)) {
        calls.splice(i, 1);
        this.lastFailCause = cause;
        return true;
      }
    });

    // If there is only one participant left of a conference, let"s
    // reset the isMpty state.
    if (calls.length == 1) {
      calls[0].isMpty = 0;
    }

    this.notify();
  },

  getCalls: function() {
    return this._calls;
  },

  isEmpty: function() {
    return this._calls.length === 0;
  },

  count: function() {
    return this._calls.length;
  },

  answer: function() {
    this.forEach(function(call) {
      if (call.state === CALL_STATE_INCOMING) {
        call.state = CALL_STATE_ACTIVE;
        return true;
      }
    });

    this.notify();
  },

  switch: function() {
    this.forEach(function switchCalls(call) {
      switch(call.state) {
        case CALL_STATE_ACTIVE:
          call.state = CALL_STATE_HOLDING;
          break;

        case CALL_STATE_HOLDING:
        case CALL_STATE_INCOMING:
          call.state = CALL_STATE_ACTIVE;
          break;
      }
    });

    this.notify();
  },

  forEach: function(callback) {
    let calls = this._calls;
    for (let i = 0; i < calls.length; i++) {
      if (callback.call(this, calls[i], i)) {
        break;
      }
    }
  },

  notify: function calls_notify() {
    setTimeout((function() {
      this.context.sendUnsolicitedCallStateChanged();
    }).bind(this));
  }
};

function ICC(iccnum, context) {
  this.iccnum = iccnum;
  this.context = context;
  this.prefName = PREF_RIL_LIBRILJS_SLOT + this.iccnum;

  this.stateV5 = [
    CARD_STATE_ABSENT,       // CARD_STATE
    CARD_PINSTATE_DISABLED,  // CARD_PINSTATE
    0,                       // GSM/UMTS
    0,                       // CDMA
    1,                       // Number of apps
    CARD_APPTYPE_SIM,        // 5
    CARD_APPSTATE_PIN,       // 6
    CARD_PERSOSUBSTATE_READY // 7
  ];

  this.stateV6 = [
    CARD_STATE_ABSENT,       // CARD_STATE
    CARD_PINSTATE_DISABLED,  // CARD_PINSTATE
    0,                       // GSM/UMTS
    0,                       // CDMA
    0,                       // IMS
    1,                       // Number of apps
    CARD_APPTYPE_SIM,        // 5
    CARD_APPSTATE_PIN,       // 6
    CARD_PERSOSUBSTATE_READY // 7
  ];

  this.codes = {
    pin: {
      code: "123" + this.iccnum,
      retry: 3,
      appState: CARD_APPSTATE_PIN,
      nextAppState: CARD_APPSTATE_PUK,
      defaultRetry: 3,
      defaultAppState: CARD_APPSTATE_PIN
    },
    puk: {
      code: "5678901" + this.iccnum,
      retry: 10,
      appState: CARD_APPSTATE_PUK,
      nextAppState: CARD_APPSTATE_ILLEGAL,
      defaultRetry: 10,
      defaultAppState: CARD_APPSTATE_PUK
    },
    pin2: {
      code: "",
      retry: -1,
      appState: -1,
      nextAppState: -1
    },
    puk2: {
      code: "",
      retry: -1,
      appState: -1,
      nextAppState: -1
    }
  };

  // Make sure a default state is present
  this.observe(undefined, NS_PREFBRANCH_PREFCHANGE_TOPIC_ID, undefined);
  Services.prefs.addObserver(this.prefName, this, false);
}

ICC.prototype = {
  files: {},
  get IMEI() {
    return "49015420323751" + this.iccnum;
  },
  get IMEISV() {
    return "490154203237510" + this.iccnum;
  },
  get IMSI() {
    return "20815550560123" + this.iccnum;
  },
  get state() {
    return (this.context.Radio.isLegacy()) ? this.stateV5 : this.stateV6;
  },
  set state(value) {
    let state = (this.context.Radio.isLegacy()) ? this.stateV5 : this.stateV6;
    state[idx] = value;
  },
  getAppStateIndex: function() {
    return (this.context.Radio.isLegacy()) ? 6 : 7;
  },
  get appState() {
    return this.state[this.getAppStateIndex()];
  },
  set appState(val) {
    this.state[this.getAppStateIndex()] = val;
    setTimeout((function() {
      this.context.sendUnsolicitedResponseSimStatusChanged();
    }).bind(this), 500);
  },
  get hasSim() {
    return this.cardState === CARD_STATE_PRESENT;
  },
  getCardStateIndex: function() {
    return 0;
  },
  get cardState() {
    return this.state[this.getCardStateIndex()];
  },
  set cardState(val) {
    if (val !== CARD_STATE_ERROR &&
        val !== CARD_STATE_PRESENT &&
        val !== CARD_STATE_ABSENT) {
      return;
    }

    let old = this.state[this.getCardStateIndex()];
    this.state[this.getCardStateIndex()] = val;

    setTimeout((function() {
      this.context.sendUnsolicitedResponseSimStatusChanged();
      this.context.sendUnsolicitedNetworkStateChanged();
    }).bind(this), 500);

    if (old === CARD_STATE_ABSENT && val === CARD_STATE_PRESENT) {
      this.lockCard("pin");
    }
  },
  get pinLocked() {
    return this.appState === this.codes.pin.appState;
  },
  get pukLocked() {
    return this.appState === this.codes.puk.appState;
  },
  get pin2Locked() {
    return this.appState === this.codes.pin2.appState;
  },
  get puk2Locked() {
    return this.appState === this.codes.puk2.appState;
  },
  get locked() {
    return (this.pinLocked || this.pin2Locked || this.pukLocked || this.puk2Locked);
  },
  lockCard: function(type) {
    if (!(type in this.codes)) {
      return false;
    }

    this.codes[type].retry = this.codes[type].defaultRetry;
    this.appState = this.codes[type].defaultAppState;
  },
  unlockCard: function(type, value) {
    if (!(type in this.codes)) {
      return false;
    }

    let lock = this.codes[type];

    if (this.appState !== lock.appState) {
      return false;
    }

    lock.retry--;

    if (lock.retry <= 0) {
      this.appState = lock.nextAppState;
    } else if (lock.code !== value) {
      this.appState = lock.appState;
    } else {
      this.appState = CARD_APPSTATE_READY;
    }

    return (this.appState === CARD_APPSTATE_READY);
  },

  observe: function PrefObserver_observe(aSubject, aTopic, aData) {
    if (aTopic === NS_PREFBRANCH_PREFCHANGE_TOPIC_ID) {
      this.context.log("Going to set: cardState: " + this.cardState);
      try {
        this.context.log("Getting pref value: " + this.prefName);
        this.cardState =
          Services.prefs.getBoolPref(this.prefName) ? CARD_STATE_PRESENT : CARD_STATE_ABSENT;
        this.context.log("Successfully read: " + this.prefName);
      } catch (e) { }
      this.context.log("From pref: cardState: " + this.cardState);
    }
  }
};

ICC.prototype.files[ICC_EF_ICCID] = {};
ICC.prototype.files[ICC_EF_ICCID][ICC_COMMAND_GET_RESPONSE] = function(output, pathId, p1, p2, p3) {
  output.writeString("0000000a2fe2040000000005020000");
};
ICC.prototype.files[ICC_EF_ICCID][ICC_COMMAND_READ_BINARY] = function(output, pathId, p1, p2, p3) {
  output.writeString("899110120000320451" + this.iccnum);
};

ICC.prototype.files[ICC_EF_AD] = {};
ICC.prototype.files[ICC_EF_AD][ICC_COMMAND_GET_RESPONSE] = function(output, pathId, p1, p2, p3) {
  output.writeString("000000046fad04000aa0aa01020000");
};
ICC.prototype.files[ICC_EF_AD][ICC_COMMAND_READ_BINARY] = function(output, pathId, p1, p2, p3) {
  output.writeString("00000002");
};

ICC.prototype.files[ICC_EF_SST] = {};
ICC.prototype.files[ICC_EF_SST][ICC_COMMAND_GET_RESPONSE] = function(output, pathId, p1, p2, p3) {
  output.writeString("0000000a6f38040000000005020000");
};
ICC.prototype.files[ICC_EF_SST][ICC_COMMAND_READ_BINARY] = function(output, pathId, p1, p2, p3) {
  /* Enabled: 1..4, 7, 9..19, 25..27, 29, 30, 38, 51..56 */
  output.writeString("ff30ffff3f003f0f000c0000f0ff00");
};

ICC.prototype.files[ICC_EF_MWIS] = {};
ICC.prototype.files[ICC_EF_MWIS][ICC_COMMAND_GET_RESPONSE] = function(output, pathId, p1, p2, p3) {
  output.writeString("000000196fca040000000005020105");
};
ICC.prototype.files[ICC_EF_MWIS][ICC_COMMAND_READ_RECORD] = function(output, pathId, p1, p2, p3) {
  // One voicemail
  output.writeString("ff0100000000000000000000000000");
};

function Network(netid, context) {
  this.netid = netid;
  this.context = context;
}

Network.prototype = {
  radioTech: NETWORK_CREG_TECH_HSPA,
  voiceRegState: NETWORK_CREG_STATE_UNKNOWN,
  dataRegState: NETWORK_CREG_STATE_UNKNOWN,
  lac: "4e71",
  cid: "00d01581",
  SMSC: "+33123456789",
  clirMode: CLIR_DEFAULT,
  get shortName() {
    return "MoCo" + this.netid;
  },
  get longName() {
    return "MozillaCorpMobile" + this.netid;
  },
  mcc: "208",
  mnc: "01",

  get voiceRegistrationState() {
    return [
      this.voiceRegState.toString(),
      this.lac.toString(),
      this.cid.toString(),
      this.radioTech.toString(),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "0",
      "fff"
    ];
  },

  get dataRegistrationState() {
    return [
      this.dataRegState.toString(),
      this.lac.toString(),
      this.cid.toString(),
      this.radioTech.toString(),
      "",
      "1"
    ];
  },

  set regState(value) {
    this.voiceRegState = value;
    this.dataRegState = value;
    this.context.sendUnsolicitedNetworkStateChanged();
  },

  get regState() {
    return this.voiceRegState;
  },
};

function Radio(radioid, context) {
  this.radioid = radioid;
  this.context = context;
}

Radio.prototype = {
  version: 6,
  isLegacy: function() {
    return (this.version < 5);
  },
  emergencyCallbackMode: true,
  state: RADIO_STATE_UNAVAILABLE,
  preferredNetworkType: -1,
  basebandVersion: "1.00.B2G.00"
};

function FakeLibRil(rilId) {
  this.rilId    = rilId;

  // Setup the system
  this.Radio   = new Radio(rilId, this);
  this.Network = new Network(rilId, this);
  this.ICC     = new ICC(rilId, this);
  this.Calls   = new Calls(rilId, this);

  this.start();
}

FakeLibRil.prototype = {

  log: function(str) {
    dump(new Date() + " =*=*= FakeLibRil[" + this.rilId + "]: " + str + "\n");
  },

  postMessage: function rild_postMessage(data) {
    let input = new ReadOnlyBuffer(data);
    while (input.count()) {
      let numberOfItems = input.readInt32BigIndian();
      let countBefore = input.count();
      let id = input.readInt32();
      let serial = input.readInt32();

      let method = this[id];
      if (!method && typeof method !== "function") {
        this.log("Unimplemented event: [" + id + "] token [" + serial + "]: " + input.data);
        input.data.splice(0, numberOfItems - 8);
        continue;
      }

      this.log("Calling: " + /^function (.+)\(/.exec(method.bind(this))[1] + ": " + input.data);

      let output = method.call(this, input, serial);
      if (!output) {
        continue;
      }
      output.finalize();

      let countAfter = input.count();
      let consumed = countBefore - countAfter;
      let delta = numberOfItems - consumed;
      if (delta > 0) {
        this.log("Parcel (" + id + ", " + serial + ") did not consumed all data: " + delta + " left over.");
        input.data.splice(0, delta);
      }

      this.log("Sent Data: " + output.data);
      this.onmessage && this.onmessage(output.data);
    }
  },

  postCommand: function rild_postCommand(id, options) {
    switch(id) {
      case COMMAND_INCOMING_CALL:
        this.sendUnsolicitedCallRing();

        setTimeout((function() {
          this.Calls.start(options.number, CALL_STATE_INCOMING);
        }).bind(this), 500);
        break;
    }
  },

  // This method is here to be overidden.
  onmessage: null,

  start: function() {
    let setInterval = function(func, wait) {
      let interval = function(w) {
        return function() {
          setTimeout(interval, w);
          func.call(null);
        };
      } (wait);
      setTimeout(interval, wait);
    };

    setTimeout((function() {
      this.sendUnsolicitedRilConnected();
    }).bind(this), 1000);

    setTimeout((function() {
      this.sendUnsolicitedRadioStateChanged();
    }).bind(this), 2000);

    setTimeout((function() {
      this.setRadioState(RADIO_STATE_OFF);
      setInterval(this.RadioNetworkUpdate.bind(this), 3000);
    }).bind(this), 4000);

    setTimeout((function() {
      this.setRadioState(RADIO_STATE_ON);
      setTimeout((function() {
        this.sendUnsolicitedNitzTime();
      }).bind(this), 3000);
    }).bind(this), 12000);

    // Notify SIM status change
    setTimeout((function() {
      this.sendUnsolicitedResponseSimStatusChanged();
    }).bind(this), 10000);

    // Notify signal changes
    setInterval(this.sendUnsolicitedSignalStrength.bind(this), 10000);
  },

  newSolicitedResponse: function(serial, success) {
    if (success === undefined) {
      success = ERROR_SUCCESS;
    }
    let output = new WriteOnlyBuffer();
    output.writeInt32(0, serial, success);
    return output;
  },

  newUnsolicitedResponse: function(type) {
    let output = new WriteOnlyBuffer();
    output.writeInt32(1, type);
    output.finalize();

    this.onmessage && this.onmessage(output.data);
  },

  sendUnsolicitedNetworkStateChanged: function() {
    this.newUnsolicitedResponse(UNSOLICITED_RESPONSE_VOICE_NETWORK_STATE_CHANGED);
  },

  sendUnsolicitedRadioStateChanged: function() {
    let output = new WriteOnlyBuffer();
    output.writeInt32(1, UNSOLICITED_RESPONSE_RADIO_STATE_CHANGED);
    output.writeInt32(this.Radio.state);
    output.finalize();

    this.onmessage && this.onmessage(output.data);
  },

  sendUnsolicitedRilConnected: function() {
    let output = new WriteOnlyBuffer();
    output.writeInt32(1, UNSOLICITED_RIL_CONNECTED);
    output.writeInt32(1);
    output.writeInt32(this.Radio.version);
    output.finalize();

    this.onmessage && this.onmessage(output.data);
  },

  sendUnsolicitedResponseSimStatusChanged: function() {
    this.newUnsolicitedResponse(UNSOLICITED_RESPONSE_SIM_STATUS_CHANGED);
  },

  sendUnsolicitedCallStateChanged: function() {
    this.newUnsolicitedResponse(UNSOLICITED_RESPONSE_CALL_STATE_CHANGED);
  },

  sendUnsolicitedExitEmergencyCallbackMode: function() {
    this.newUnsolicitedResponse(UNSOLICITED_EXIT_EMERGENCY_CALLBACK_MODE);
  },

  writeSignalStrength: function(output) {
    let signalStrength = getRandomInt(0, 31);
    let bitErrorRate = getRandomInt(0, 7);
    output.writeInt32(
      // RIL_GW_SignalStrength
      signalStrength,
      bitErrorRate,
      // RIL_CDMA_SignalStrength
      0,
      0,
      // RIL_EVDO_SignalStrength
      0,
      0,
      0
    );

    // Starting with RIL v6, send LTE signal
    if (!this.Radio.isLegacy()) {
      output.writeInt32(
        -1, // lteSignalStrength
        -1, // lteRSRP
        -1, // lteRSRQ
        -1, // lteRSSNR
        -1  // lteCQI
      );
    }
  },

  sendUnsolicitedSignalStrength: function() {
    let output = new WriteOnlyBuffer();
    output.writeInt32(1, UNSOLICITED_SIGNAL_STRENGTH);
    this.writeSignalStrength(output);
    output.finalize();

    this.onmessage && this.onmessage(output.data);
  },

  sendUnsolicitedNitzTime: function() {
    let output = new WriteOnlyBuffer();
    output.writeInt32(1, UNSOLICITED_NITZ_TIME_RECEIVED);
    // yy/mm/dd,hh:mm:ss(+/-)tz,dt
    let dateNitz = "12/02/16,03:36:08-20,00,310410";
    output.writeString(dateNitz);
    output.finalize();

    this.onmessage && this.onmessage(output.data);
  },

  sendUnsolicitedCallRing: function() {
    this.newUnsolicitedResponse(UNSOLICITED_CALL_RING);
  },

  sendSimAbsent: function(serial) {
    let output = this.newSolicitedResponse(serial, ERROR_SIM_ABSENT);
    this.log("Sending ERROR_SIM_ABSENT: " + output.data);
    output.finalize();
    this.onmessage && this.onmessage(output.data);
  },

  checkRadioOn: function() {
    return (this.Radio.state === RADIO_STATE_ON);
  },

  checkAndNotifyRadioOn: function(serial) {
    let retval = this.checkRadioOn();
    if (!retval) {
      this.sendRadioNotAvailable(serial);
    }
    return retval;
  },

  sendRadioNotAvailable: function(serial) {
    let output = this.newSolicitedResponse(serial, ERROR_RADIO_NOT_AVAILABLE);
    this.log("Sending ERROR_RADIO_NOT_AVAILABLE: " + output.data);
    output.finalize();
    this.onmessage && this.onmessage(output.data);
  },

  setRadioState: function(newState) {
    this.log("setRadioState: transitionning Radio.state from " + this.Radio.state + " to " + newState);
    this.Radio.state = newState;
    setTimeout((function() {
      this.sendUnsolicitedRadioStateChanged();
    }).bind(this), 1000);
  },

  // Update radio state and network state
  RadioNetworkUpdate: function() {
    if (this.Radio.state === RADIO_STATE_ON) {
      let newState = NETWORK_CREG_STATE_UNKNOWN;
      let oldState = this.Network.regState;
      switch(this.Network.regState) {
        case NETWORK_CREG_STATE_NOT_SEARCHING:
        case NETWORK_CREG_STATE_NOT_SEARCHING_EMERGENCY_CALLS:
          newState = this.ICC.locked ? NETWORK_CREG_STATE_SEARCHING_EMERGENCY_CALLS : NETWORK_CREG_STATE_SEARCHING;
          break;
        case NETWORK_CREG_STATE_SEARCHING:
        case NETWORK_CREG_STATE_SEARCHING_EMERGENCY_CALLS:
          newState = this.ICC.locked ? NETWORK_CREG_STATE_SEARCHING_EMERGENCY_CALLS : NETWORK_CREG_STATE_REGISTERED_HOME;
          break;
        case NETWORK_CREG_STATE_REGISTERED_HOME:
        case NETWORK_CREG_STATE_REGISTERED_ROAMING:
          newState = this.ICC.locked ? NETWORK_CREG_STATE_DENIED : oldState;
          break;
        case NETWORK_CREG_STATE_UNKNOWN:
          newState = this.ICC.locked ? NETWORK_CREG_STATE_NOT_SEARCHING_EMERGENCY_CALLS : NETWORK_CREG_STATE_NOT_SEARCHING;
          break;
        default:
          this.log("RadioNetworkUpdate: radio is on ... cannot transitiong from " + oldState);
          break;
      }
      if (this.ICC.cardState !== CARD_STATE_PRESENT) {
        newState = NETWORK_CREG_STATE_NOT_SEARCHING_EMERGENCY_CALLS;
      }
      this.log("RadioNetworkUpdate: radio is on ... transitionning from " + oldState + " to " + newState);
      this.Network.regState = newState;
    } else {
      this.log("RadioNetworkUpdate: radio is off, setting NOT_SEARCHING");
      this.Network.regState = NETWORK_CREG_STATE_NOT_SEARCHING;
    }
  }
};

FakeLibRil.prototype[REQUEST_ENTER_SIM_PIN] = function ENTER_SIM_PIN(input, serial) {
  let pinType = "pin";

  let v5legacy = input.readInt32();
  let pinCode = input.readString();
  if (v5legacy === 1) {
    let aid = input.readString();
  }

  let unlocked = this.ICC.unlockCard(pinType, pinCode);
  let errorCode = unlocked ? ERROR_SUCCESS : ERROR_GENERIC_FAILURE;

  let out = this.newSolicitedResponse(serial, errorCode);
  out.writeInt32(1);
  out.writeInt32(this.ICC.codes[pinType].retry);
  return out;
};

FakeLibRil.prototype[REQUEST_ENTER_SIM_PUK] = function ENTER_SIM_PUK(input, serial) {
  let pinType = "puk";

  let v5legacy = input.readInt32();
  let pukCode = input.readString();
  let newPinCode = input.readString();
  if (v5legacy === 1) {
    let aid = input.readString();
  }

  let unlocked = this.ICC.unlockCard(pinType, pukCode);
  let errorCode = unlocked ? ERROR_SUCCESS : ERROR_GENERIC_FAILURE;

  if (unlocked) {
    this.ICC.codes.pin.code = newPinCode;
  }

  let out = this.newSolicitedResponse(serial, errorCode);
  out.writeInt32(1);
  out.writeInt32(this.ICC.codes[pinType].retry);
  return out;
};

FakeLibRil.prototype[REQUEST_GET_SIM_STATUS] = function GET_SIM_STATUS(input, serial) {
  if (!this.checkAndNotifyRadioOn(serial)) {
    return;
  }

  let output = this.newSolicitedResponse(serial);
  output.writeInt32List(this.ICC.state);
  output.writeString("sim:aa:" + this.ICC.iccnum);
  output.writeString("sim:bb:" + this.ICC.iccnum);
  output.writeInt32(0, 0, 0);
  return output;
};

FakeLibRil.prototype[REQUEST_GET_SMSC_ADDRESS] = function GET_SMSC_ADDRESS(input, serial) {
  let output = this.newSolicitedResponse(serial);
  output.writeString(this.Network.SMSC);
  return output;
};

FakeLibRil.prototype[REQUEST_GET_IMEI] = function GET_IMEI(input, serial) {
  let output = this.newSolicitedResponse(serial);
  output.writeString(this.ICC.IMEI);
  return output;
};

FakeLibRil.prototype[REQUEST_GET_IMEISV] = function GET_IMEISV(input, serial) {
  let output = this.newSolicitedResponse(serial);
  output.writeString(this.ICC.IMEISV);
  return output;
};

FakeLibRil.prototype[REQUEST_GET_IMSI] = function GET_IMSI(input, serial) {
  input.readInt32();
  let aid = input.readString();
  let output = this.newSolicitedResponse(serial);
  output.writeString(this.ICC.IMSI);
  return output;
};

FakeLibRil.prototype[REQUEST_SIM_IO] = function SIM_IO(input, serial) {
  let command = input.readInt32();
  let fileId = input.readInt32();
  let pathId = input.readString();
  let p1 = input.readInt32();
  let p2 = input.readInt32();
  let p3 = input.readInt32();

  this.log("Received SIM_IO: " + command.toString(16) + "::" + fileId.toString(16) + "/" + pathId);

  if (!this.checkAndNotifyRadioOn(serial)) {
    return;
  }

  let setOkSwFields = (function() { // set sw1,sw2
    let output = this.newSolicitedResponse(serial);
    output.writeInt32(ICC_STATUS_NORMAL_ENDING);
    output.writeInt32(0x00);
    return output;
  }).bind(this);

  let setNokSwFields = (function() { // set sw1,sw2
    let output = this.newSolicitedResponse(serial);
    output.writeInt32(ICC_STATUS_ERROR_WRONG_PARAMETERS);
    output.writeInt32(0x00);
    return output;
  }).bind(this);

  let unsupported = (function() { // set sw1,sw2
    this.log("Unimplemented SIM_IO: " + command.toString(16) + "::" + fileId.toString(16) + "/" + pathId);
    let output = this.newSolicitedResponse(serial, ERROR_REQUEST_NOT_SUPPORTED);
    output.writeInt32(ICC_STATUS_ERROR_WRONG_PARAMETERS);
    output.writeInt32(0x00);
    return output;
  }).bind(this);

  if (!(fileId in this.ICC.files)) {
    return unsupported();
  }

  let file = this.ICC.files[fileId];

  if (!(command in file)) {
    return unsupported();
  }

  let output = setOkSwFields();
  file[command].call(this.ICC, output, pathId, p1, p2, p3);
  return output;
};

FakeLibRil.prototype[REQUEST_VOICE_RADIO_TECH] = function VOICE_RADIO_TECH(input, serial) {
  if (!this.checkAndNotifyRadioOn(serial)) {
    return;
  }

  let output = this.newSolicitedResponse(serial);
  output.writeInt32(1);
  output.writeInt32(this.Radio.radioTech);
  return output;
};

FakeLibRil.prototype[REQUEST_BASEBAND_VERSION] = function BASEBAND_VERSION(input, serial) {
  if (!this.checkAndNotifyRadioOn(serial)) {
    return;
  }

  let output = this.newSolicitedResponse(serial);
  output.writeString(this.Radio.basebandVersion);
  return output;
};

FakeLibRil.prototype[REQUEST_RADIO_POWER] = function RADIO_POWER(input, serial) {
  let length = input.readInt32();
  let newState = (input.readInt32() === 1) ? RADIO_STATE_ON : RADIO_STATE_OFF;
  this.setRadioState(newState);

  let output = this.newSolicitedResponse(serial);
  return output;
};

FakeLibRil.prototype[REQUEST_SET_CLIR] = function SET_CLIR(input, serial) {
  let length = input.readInt32();
  this.Network.clirMode = input.readInt32();
  let output = this.newSolicitedResponse(serial);
  return output;
};

FakeLibRil.prototype[REQUEST_GET_CLIR] = function GET_CLIR(input, serial) {
  let output = this.newSolicitedResponse(serial);
  output.writeInt32(1);
  output.writeInt32(this.Network.clirMode);
  return output;
};

FakeLibRil.prototype[REQUEST_QUERY_NETWORK_SELECTION_MODE] = function QUERY_NETWORK_SELECTION_MODE(input, serial) {
  let output = this.newSolicitedResponse(serial);
  output.writeInt32(NETWORK_SELECTION_MODE_AUTOMATIC);
  return output;
};

FakeLibRil.prototype[REQUEST_EXIT_EMERGENCY_CALLBACK_MODE] = function EXIT_EMERGENCY_CALLBACK_MODE(input, serial) {
  this.Radio.emergencyCallbackMode = false;
  let output = this.newSolicitedResponse(serial);
  this.sendUnsolicitedExitEmergencyCallbackMode();
  return output;
};

FakeLibRil.prototype[REQUEST_GET_CURRENT_CALLS] = function GET_CURRENT_CALLS(input, serial) {
  let output = this.newSolicitedResponse(serial);
  if (this.Calls.isEmpty()) {
    return output;
  }

  output.writeInt32(this.Calls.count());

  this.Calls.forEach(function(call) {
    output.writeInt32(call.state);
    output.writeInt32(call.index);
    output.writeInt32(129); // toa
    output.writeInt32(call.isMpty);
    output.writeInt32(0);  // boolean isMobileTerminated
    output.writeInt32(0); // als
    output.writeInt32(1); // boolean isVoice
    output.writeInt32(0); // boolean isVoicePrivac
    output.writeString(call.number); //
    output.writeInt32(0); // Number presentation
    output.writeString([]); // Remote party name
    output.writeInt32(0); // Name Presentation
    output.writeInt32(0); // boolean hasUSSInf
  });

  return output;
};


FakeLibRil.prototype[REQUEST_DIAL] = function DIAL(input, serial) {
  this.Calls.start(input.readString(), CALL_STATE_DIALING);

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_HANGUP] = function HANGUP(input, serial) {
  let connectionIndex = 1;
  if (input.count()) {
    let numberOfInts = input.readInt32();
    connectionIndex = input.readInt32();
  }

  this.Calls.stop(connectionIndex, CALL_FAIL_NORMAL);

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_HANGUP_WAITING_OR_BACKGROUND] = function HANGUP_WAITING_OR_BACKGROUND(input, serial) {
  this.Calls.forEach((function stopCall(call) {
    this.Calls.stop(call.index, CALL_FAIL_NORMAL);
  }).bind(this));

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_UDUB] = function UDUB(input, serial) {
  this.Calls.stop(0, CALL_FAIL_BUSY);

  return this.newSolicitedResponse(serial);
};

FakeLibRil.prototype[REQUEST_VOICE_REGISTRATION_STATE] = function VOICE_REGISTRATION_STATE(input, serial) {
  if (!this.checkAndNotifyRadioOn(serial)) {
    return;
  }

  let output = this.newSolicitedResponse(serial);
  output.writeStringList(this.Network.voiceRegistrationState);
  return output;
};

FakeLibRil.prototype[REQUEST_DATA_REGISTRATION_STATE] = function DATA_REGISTRATION_STATE(input, serial) {
  if (!this.checkAndNotifyRadioOn(serial)) {
    return;
  }

  let output = this.newSolicitedResponse(serial);
  output.writeStringList(this.Network.dataRegistrationState);
  return output;
};

FakeLibRil.prototype[REQUEST_OPERATOR] = function REQUEST_OPERATOR(input, serial) {
  if (!this.checkAndNotifyRadioOn(serial)) {
    return;
  }

  let output = this.newSolicitedResponse(serial);
  output.writeStringList([this.Network.longName, this.Network.shortName, this.Network.mcc + this.Network.mnc]);
  return output;
};

FakeLibRil.prototype[REQUEST_SWITCH_WAITING_OR_HOLDING_AND_ACTIVE] = function SWITCH_WAITING_OR_HOLDING_AND_ACTIVE(input, serial) {
  this.Calls.switch();

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_CONFERENCE] = function CONFERENCE(input, serial) {
  this.Calls.forEach(function changeConference(call) {
    call.state = CALL_STATE_ACTIVE;
    call.isMpty = 1;
  });

  this.Calls.notify();

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_LAST_CALL_FAIL_CAUSE] = function LAST_CALL_FAIL_CAUSE(input, serial) {
  let output = this.newSolicitedResponse(serial);
  output.writeInt32(1, this.Calls.lastFailCause);

  return output;
};


FakeLibRil.prototype[REQUEST_SIGNAL_STRENGTH] = function SIGNAL_STRENGTH(input, serial) {
  let output = this.newSolicitedResponse(serial);
  this.writeSignalStrength(output);
  return output;
};


FakeLibRil.prototype[REQUEST_ANSWER] = function ANSWER(input, serial) {
  this.Calls.answer();

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_DTMF_START] = function DTMF_START(input, serial) {
  let numberOfInts = input.readInt32();
  let char = String.fromCharCode(input.readInt32());

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_DTMF_STOP] = function DTMF_STOP(input, serial) {

  return this.newSolicitedResponse(serial);
};


FakeLibRil.prototype[REQUEST_GET_PREFERRED_NETWORK_TYPE] = function GET_PREFERRED_NETWORK_TYPE(input, serial) {
  let output = this.newSolicitedResponse(serial);
  output.writeInt32(1);
  output.writeInt32(this.Radio.preferredNetworkType);
  return output;
};

FakeLibRil.prototype[REQUEST_SET_PREFERRED_NETWORK_TYPE] = function SET_PREFERRED_NETWORK_TYPE(input, serial) {
  let length = input.readInt32();
  this.Radio.preferredNetworkType = input.readInt32();
  let output = this.newSolicitedResponse(serial);
  return output;
};

FakeLibRil.prototype[REQUEST_CDMA_SET_ROAMING_PREFERENCE] = function CDMA_SET_ROAMING_PREFERENCE(input, serial) {
  let numberOfInts = input.readInt32();
  let roamingMode = input.readInt32();

  return this.newSolicitedResponse(serial);
};

FakeLibRil.prototype[REQUEST_CDMA_SET_PREFERRED_VOICE_PRIVACY_MODE] = function CDMA_SET_PREFERRED_VOICE_PRICACY_MODE(input, serial) {
  let numberOfInts = input.readInt32();
  let preferredMode = input.readInt32();

  return this.newSolicitedResponse(serial);
};

this.FakeLibRil = FakeLibRil;
