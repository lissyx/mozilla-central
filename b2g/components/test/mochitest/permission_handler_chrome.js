/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

function debug(str) {
  dump("CHROME PERMISSON HANDLER -- " + str + "\n");
}

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

const { Services } = Cu.import("resource://gre/modules/Services.jsm");
const { SystemApp } = Cu.import("resource://gre/modules/SystemApp.jsm");

let eventHandler = function(evt) {
  if (!evt.detail || evt.detail.type !== "permission-prompt") {
    return;
  }

  sendAsyncMessage("permission-request", evt.detail.permissions);
};

SystemApp.addEventListener("mozChromeEvent", eventHandler);

// need to remove ChromeEvent listener after test finished.
addMessageListener("teardown", function() {
  SystemApp.removeEventListener("mozChromeEvent", eventHandler);
});
