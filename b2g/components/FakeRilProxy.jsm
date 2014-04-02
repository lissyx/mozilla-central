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

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import("resource://gre/modules/Services.jsm");

Services.scriptloader.loadSubScript("resource://gre/modules/FakeLibRil.js", this)

this.EXPORTED_SYMBOLS = [""];

let FakeRilProxy = function(rilProxyId) {

  this.rilProxyId = rilProxyId;
  this.libRil = new FakeLibRil(this.rilProxyId);

  function debug(str) {
    dump("RILProxy[" + this.rilProxyId + "]: " + str + "\n");
  }

  let CC = Components.Constructor;

  const ServerSocket = CC("@mozilla.org/network/server-socket;1",
                          "nsIServerSocket",
                          "init");

  const InputStreamPump = CC("@mozilla.org/network/input-stream-pump;1",
                             "nsIInputStreamPump",
                             "init");

  const BinaryInputStream = CC("@mozilla.org/binaryinputstream;1",
                               "nsIBinaryInputStream",
                               "setInputStream");

  const BinaryOutputStream = CC("@mozilla.org/binaryoutputstream;1",
                                "nsIBinaryOutputStream",
                                "setOutputStream");

  let self = this;
  let server = null;
  function start() {
    server = new ServerSocket(6200 + self.rilProxyId, true, -1);
    server.asyncListen(getSocketListener());
  }

  function stop() {
    server.close();
  }

  function DataListener() {
    return {
      onStartRequest: function onStart(request, context) {},
      onStopRequest: function onStop(request, context, status) {},
      onDataAvailable: function onDatavailable(request,
                                               context,
                                               inputStream,
                                               offset,
                                               count) {
        let wrapper = new BinaryInputStream(inputStream);
        let str = [];
        while (count) {
          str.push(wrapper.readByteArray(1));
          count--;
        }

        self.libRil.postMessage(str);
      }
    }
  }

  function getSocketListener() {
    return {
      onSocketAccepted: function onConnect(socket, transport) {
        let is = transport.openInputStream(0, 0, 0);
        let pump = new InputStreamPump(is, -1, -1, 0, 0, true);
        pump.asyncRead(new DataListener(), null);

        let os = transport.openOutputStream(0, 0, 0);
        let output = new BinaryOutputStream(os);

        self.libRil.onmessage = function(data) {
          if (data) {
            output.writeByteArray(data, data.length);
          }
        }
      },

      onStopListening: function onDisconnect(socket, status) {}
    };
  }

  start();
};

let fakeRil = false;
try {
  fakeRil = Services.prefs.getBoolPref("ril.libriljs.enabled");
} catch(e) { }

dump("FakeRilProxy: ril.libriljs.enabled=" + fakeRil + "\n");

if (fakeRil) {
  let interfaces = 1;
  try {
    interfaces = Services.prefs.getIntPref("ril.libriljs.numInterfaces");
  } catch(e) { }

  dump("FakeRilProxy: ril.libriljs.numInterfaces=" + interfaces + "\n");
  for (let i = 0; i < interfaces; i++) {
    dump("FakeRilProxy: new FakeRilProxy(" + i + ")\n");
    new FakeRilProxy(i);
  }
}
