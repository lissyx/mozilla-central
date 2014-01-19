/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

window.addEventListener("ContentStart", function(evt) {
  // Enable touch event shim on desktop that translates mouse events
  // into touch ones
  let require = Cu.import("resource://gre/modules/devtools/Loader.jsm", {})
                  .devtools.require;
  let { TouchEventHandler } = require("devtools/touch-events");
  let chromeEventHandler = window.QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIWebNavigation)
                                 .QueryInterface(Ci.nsIDocShell)
                                 .chromeEventHandler || window;
  let touchEventHandler = new TouchEventHandler(chromeEventHandler);
  touchEventHandler.start();
});


function initResponsiveDesign(browserWindow) {
  // Inject custom controls in responsive view
  Cu.import('resource:///modules/devtools/responsivedesign.jsm');
  ResponsiveUIManager.once('on', function(event, tab, responsive) {
    let document = tab.ownerDocument;

    // Ensure tweaking only the first responsive mode opened
    responsive.stack.classList.add('os-mode');

    let sleepButton = document.createElement('button');
    sleepButton.id = 'os-sleep-button';
    sleepButton.setAttribute('top', 0);
    sleepButton.setAttribute('right', 0);
    sleepButton.addEventListener('mousedown', function() {
      shell.sendChromeEvent({type: 'sleep-button-press'});
    });
    sleepButton.addEventListener('mouseup', function() {
      shell.sendChromeEvent({type: 'sleep-button-release'});
    });
    responsive.stack.appendChild(sleepButton);

    let volumeButtons = document.createElement('vbox');
    volumeButtons.id = 'os-volume-buttons';
    volumeButtons.setAttribute('top', 0);
    volumeButtons.setAttribute('left', 0);

    let volumeUp = document.createElement('button');
    volumeUp.id = 'os-volume-up-button';
    volumeUp.addEventListener('mousedown', function() {
      shell.sendChromeEvent({type: 'volume-up-button-press'});
    });
    volumeUp.addEventListener('mouseup', function() {
      shell.sendChromeEvent({type: 'volume-up-button-release'});
    });

    let volumeDown = document.createElement('button');
    volumeDown.id = 'os-volume-down-button';
    volumeDown.addEventListener('mousedown', function() {
      shell.sendChromeEvent({type: 'volume-down-button-press'});
    });
    volumeDown.addEventListener('mouseup', function() {
      shell.sendChromeEvent({type: 'volume-down-button-release'});
    });

    volumeButtons.appendChild(volumeUp);
    volumeButtons.appendChild(volumeDown);
    responsive.stack.appendChild(volumeButtons);

    // <toolbar id="os-hardware-button">
    //  <toolbarbutton id="os-home-button" />
    // </toolbar>
    let bottomToolbar = document.createElement('toolbar');
    bottomToolbar.id = 'os-hardware-buttons';
    bottomToolbar.setAttribute('align', 'center');
    bottomToolbar.setAttribute('pack', 'center');

    let homeButton = document.createElement('toolbarbutton');
    homeButton.id = 'os-home-button';
    homeButton.setAttribute('class', 'devtools-toolbarbutton');

    homeButton.addEventListener('mousedown', function() {
      shell.sendChromeEvent({type: 'home-button-press'});
    });
    homeButton.addEventListener('mouseup', function() {
      shell.sendChromeEvent({type: 'home-button-release'});
    });
    bottomToolbar.appendChild(homeButton);
    responsive.container.appendChild(bottomToolbar);
  });

  // Cleanup responsive mode if it's disabled
  ResponsiveUIManager.on('off', function(event, tab, responsive) {
    if (responsive.stack.classList.contains('os-mode')) {
      responsive.stack.classList.remove('os-mode');
      let document = tab.ownerDocument;
      let sleepButton = document.getElementById('os-sleep-button');
      responsive.stack.removeChild(sleepButton);
      let volumeButtons = document.getElementById('os-volume-buttons');
      responsive.stack.removeChild(volumeButtons);
      let bottomToolbar = document.getElementById('os-hardware-buttons');
      responsive.container.removeChild(bottomToolbar);
    }
  });

  // Automatically toggle responsive design mode
  let width = 320, height = 480;
  // We have to take into account padding and border introduced with the
  // device look'n feel:
  width += 15*2; // Horizontal padding
  width += 1*2; // Vertical border
  height += 60; // Top Padding
  height += 1; // Top border
  let args = {'width': width, 'height': height};
  let mgr = browserWindow.ResponsiveUI.ResponsiveUIManager;
  mgr.handleGcliCommand(browserWindow,
                        browserWindow.gBrowser.selectedTab,
                        'resize to',
                        args);

  // Enable touch events
  browserWindow.gBrowser.selectedTab.__responsiveUI.enableTouch();
}

let browserWindow = Services.wm.getMostRecentWindow("navigator:browser");
// On Firefox mulet, we enable responsive mode when loading b2g
if ("ResponsiveUI" in browserWindow) {
  // Inject CSS in browser to customize responsive view
  let doc = browserWindow.document;
  let pi = doc.createProcessingInstruction('xml-stylesheet', 'href="chrome://b2g/content/browser.css" type="text/css"');
  doc.insertBefore(pi, doc.firstChild);

  initResponsiveDesign(browserWindow);

  // And devtool panel while maximizing its size according to screen size
  Services.prefs.setIntPref('devtools.toolbox.sidebar.width',
                            browserWindow.outerWidth - 550);
  Cu.import('resource:///modules/devtools/gDevTools.jsm');
  gDevToolsBrowser.selectToolCommand(browserWindow.gBrowser);
}
