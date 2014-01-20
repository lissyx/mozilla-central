const Cu = Components.utils;

const { Services } = Cu.import("resource://gre/modules/Services.jsm");

// Load a duplicated copy of the jsm to prevent messing with the currently running one
let scope = {};
Services.scriptloader.loadSubScript("resource://gre/modules/SystemApp.jsm", scope);
const { SystemApp } = scope;

let frame;

let index = -1;
function next() {
  index++;
  if (index >= steps.length) {
    assert.ok(false, "Shouldn't get here!");
    return;
  }
  try {
    steps[index]();
  } catch(ex) {
    assert.ok(false, "Caught exception: " + ex);
  }
}

// Listen for events received by the system app document
// to ensure that we receive all of them, in an expected order and time
let isLoaded = false;
let n = 0;
function listener(event) {
  dump("listener("+event.type+" / "+event.detail.name+")\n");
  if (!isLoaded) {
    assert.ok(false, "Received event before the iframe is ready");
    return;
  }
  n++;
  if (n == 1) {
    assert.equal(event.type, "mozChromeEvent");
    assert.equal(event.detail.name, "first");
  } else if (n == 2) {
    assert.equal(event.type, "custom");
    assert.equal(event.detail.name, "second");

    next(); // call checkEventDispatching
  } else if (n == 3) {
    assert.equal(event.type, "custom");
    assert.equal(event.detail.name, "third");
  } else if (n == 4) {
    assert.equal(event.type, "mozChromeEvent");
    assert.equal(event.detail.name, "fourth");

    next(); // call checkEventListening();
  } else {
    assert.ok(false, "Unexpected event of type " + event.type);
  }
}


let steps = [
  function earlyEvents() {
    // Immediatly try to send events
    SystemApp.sendChromeEvent({ name: "first" });
    SystemApp.sendCustomEvent("custom", { name: "second" });
    next();
  },

  function earlyNavigatorUsage() {
    // Immediatly tries to play with SystemApp.navigator
    let all = SystemApp.navigator.mozApps.mgmt.getAll();
    all.onsuccess = function() {
      assert.ok(true, "navigator works");
      next();
    };
  },

  function createFrame() {
    // Create a fake system app frame
    let win = Services.wm.getMostRecentWindow("navigator:browser");
    let doc = win.document;
    frame = doc.createElement("iframe");
    doc.documentElement.appendChild(frame);

    // Ensure that events are correctly sent to the frame.
    // `listener` is going to call next()
    frame.contentWindow.addEventListener("mozChromeEvent", listener);
    frame.contentWindow.addEventListener("custom", listener);

    // Register it to the JSM
    SystemApp.registerFrame(frame);
    assert.ok(true, "Frame created and registered");

    frame.contentWindow.addEventListener("load", function onload() {
      frame.contentWindow.removeEventListener("load", onload);
      assert.ok(true, "Frame document loaded");

      // Declare that the iframe is now loaded.
      // That should dispatch early events
      isLoaded = true;
      SystemApp.setIsLoaded();
      assert.ok(true, "Frame declared as loaded");

      // Once pending events are received,
      // we will run checkEventDispatching
    });

    frame.setAttribute("src", "data:text/html,system app");
  },

  function checkEventDispatching() {
    // Send events after the iframe is ready,
    // they should be dispatched right away
    SystemApp.sendCustomEvent("custom", { name: "third" });
    SystemApp.sendChromeEvent({ name: "fourth" });
    // Once this 4th event is received, we will run checkEventListening
  },

  function checkEventListening() {
    SystemApp.addEventListener("mozContentEvent", function onContentEvent(event) {
      assert.equal(event.detail.name, "first-content", "received a system app event");
      SystemApp.removeEventListener("mozContentEvent", onContentEvent);

      next();
    });
    let win = frame.contentWindow;
    win.dispatchEvent(new win.CustomEvent("mozContentEvent", { detail: {name: "first-content"} }));
  },

  function endOfTest() {
    frame.remove();
    sendAsyncMessage("finish");
  }
];

next();
