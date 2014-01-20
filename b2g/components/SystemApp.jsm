/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { classes: Cc, interfaces: Ci, utils: Cu } = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import('resource://gre/modules/ObjectWrapper.jsm');

this.EXPORTED_SYMBOLS = ["SystemApp"];

let SystemApp = {
  _frame: null,
  _isLoaded: false,
  _pendingChromeEvents: [],
  _pendingListeners: [],

  // Returns a reference to a full featured navigator object
  // either the system app one, or a top level xul window one,
  // if the system app isn't loaded yet.
  get navigator() {
    return this._frame ? this._frame.contentWindow.navigator
                       : Services.wm.getMostRecentWindow('navigator:browser').navigator;
  },

  // To call when a new system app iframe is created
  registerFrame: function (frame) {
    this._isLoaded = false;
    this._frame = frame;

    // Register all DOM event listeners added before we got a ref to the app iframe
    this._pendingListeners
        .forEach((args) =>
                 this.addEventListener.apply(this, args));
    this._pendingListeners = [];
  },

  // To call when it is ready to receive events
  setIsLoaded: function () {
    this._isLoaded = true;

    // Dispatch all events being queued while the system app was still loading
    this._pendingChromeEvents
        .forEach(([type, details]) =>
                 this.sendCustomEvent(type, details));
    this._pendingChromeEvents = [];
  },

  /*
   * Common way to send an event to the system app.
   *
   * // In gecko code:
   *   SystemApp.sendCustomEvent('foo', { data: 'bar' });
   * // In system app:
   *   window.addEventListener('foo', function (event) {
   *     event.details == 'bar'
   *   });
   */
  sendCustomEvent: function systemApp_sendCustomEvent(type, details) {
    let content = this._frame ? this._frame.contentWindow : null;

    // If the system app isn't ready yet,
    // queue events until someone calls setIsLoaded
    if (!this._isLoaded || !content) {
      this._pendingChromeEvents.push([type, details]);
      return false;
    }
    let event = content.document.createEvent('CustomEvent');

    let payload;
    // If the root object already has __exposedProps__,
    // we consider the caller already wrapped (correctly) the object.
    if ("__exposedProps__" in details) {
      payload = details;
    } else {
      payload = details ? ObjectWrapper.wrap(details, content) : {};
    }

    event.initCustomEvent(type, true, true, payload);
    content.dispatchEvent(event);

    return true;
  },

  // Now deprecated, use sendCustomEvent with a custom event name
  sendChromeEvent: function systemApp_sendChromeEvent(details) {
    this.sendCustomEvent("mozChromeEvent", details);
  },

  // Listen for dom events on the system app
  addEventListener: function systemApp_addEventListener() {
    let content = this._frame ? this._frame.contentWindow : null;
    if (!content) {
      Cu.reportError("Trying to add a system app event listener while the app is still loading");
      this._pendingListeners.push(arguments);
      return false;
    }

    content.addEventListener.apply(content, arguments);
    return true;
  },

  removeEventListener: function systemApp_removeEventListener() {
    let content = this._frame ? this._frame.contentWindow : null;
    if (content) {
      content.removeEventListener.apply(content, arguments);
    }
  }

};
this.SystemApp = SystemApp;

