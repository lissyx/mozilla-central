/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var EXPORTED_SYMBOLS = [];

const {XPCOMUtils} = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
const {Services} = ChromeUtils.import("resource://gre/modules/Services.jsm");
const {AppConstants} = ChromeUtils.import("resource://gre/modules/AppConstants.jsm");

ChromeUtils.defineModuleGetter(this, "OS", "resource://gre/modules/osfile.jsm");
ChromeUtils.defineModuleGetter(this, "Downloads", "resource://gre/modules/Downloads.jsm");
ChromeUtils.defineModuleGetter(this, "FileUtils", "resource://gre/modules/FileUtils.jsm");
ChromeUtils.defineModuleGetter(this, "ZipUtils", "resource://gre/modules/ZipUtils.jsm");

var AboutDeepSpeech = {
  dsPath: OS.Path.join(OS.Constants.Path.profileDir, "deepspeech"),

  libdeepspeechZip: {
    'linux':  'https://community-tc.services.mozilla.com/api/index/v1/task/project.deepspeech.deepspeech.native_client.v0.6.0-alpha.15.tflite/artifacts/public/libdeepspeech.zip',
    'macosx': 'https://community-tc.services.mozilla.com/api/index/v1/task/project.deepspeech.deepspeech.native_client.v0.6.0-alpha.15.osx-tflite/artifacts/public/libdeepspeech.zip',
    'win':    'https://community-tc.services.mozilla.com/api/index/v1/task/project.deepspeech.deepspeech.native_client.v0.6.0-alpha.15.win-tflite/artifacts/public/libdeepspeech.zip',
  },

  modelsZip: {
    'en-us': 'https://github.com/lissyx/DeepSpeech/releases/download/v0.6.0-alpha.15/en-us.zip',
    'fr-fr': 'https://github.com/lissyx/DeepSpeech/releases/download/v0.6.0-alpha.15/fr-fr.zip',
  },

  modelRequiredFiles: [
    'output_graph.tflite',
    'lm.binary',
    'trie',
    'info.json',
  ],

  prefRoot: "media.webspeech.service.deepspeech.",
  params: [
    "beamWidth",
    "lmAlpha",
    "lmBeta",
  ],

  getPref(name) {
    const type = Services.prefs.getPrefType(name);
    switch (type) {
      case Services.prefs.PREF_STRING:
        return Services.prefs.getCharPref(name);
      case Services.prefs.PREF_INT:
        return Services.prefs.getIntPref(name);
      case Services.prefs.PREF_BOOL:
        return Services.prefs.getBoolPref(name);
      default:
        throw new Error("Unknown type");
    }
  },

  setPref(name, value) {
    const type = Services.prefs.getPrefType(name);
    switch (type) {
      case Services.prefs.PREF_STRING:
        return Services.prefs.setCharPref(name, value);
      case Services.prefs.PREF_INT:
        return Services.prefs.setIntPref(name, value);
      case Services.prefs.PREF_BOOL:
        return Services.prefs.setBoolPref(name, value);
      default:
        throw new Error("Unknown type");
    }
  },

  setStatusMessage(msg) {
    let statusLong = document.getElementById('status-long');
    statusLong.textContent = msg;
  },

  handleStatus() {
    let root   = document.getElementById('api-status');
    let enable = document.createElement('input');
    enable.type    = 'checkbox';
    enable.id      = this.prefRoot + "enabled";
    enable.checked = this.getPref(enable.id) ? "checked" : "";
    enable.addEventListener('change', v => {
      console.debug('enable.id', enable.id, 'enable.checked', enable.checked);
      this.setPref(enable.id, enable.checked);
    });
    root.appendChild(enable);
  },

  disableStatus() {
    let checkbox      = document.getElementById(this.prefRoot + "enabled");
    checkbox.disabled = 'disabled';
  },

  async populateParameters(model) {
    let info = await OS.File.read(OS.Path.join(this.dsPath, "models", model, "info.json"), { encoding: "utf-8" });
    let modelDesc = JSON.parse(info);
    let modelName = modelDesc['name'];

    let root = document.getElementById('parameters-model-' + model);
    let span = document.createElement('span');
    span.textContent = modelName;
    root.appendChild(span);

    for (let param in this.params) {
      let paramName = this.params[param];
      console.debug("paramName=" + paramName);
      let li = document.createElement('li');
      let label = document.createElement('label');
      label.textContent = paramName + ": " + modelDesc['parameters'][paramName];
      li.appendChild(label);
      root.appendChild(li);
    }
  },

  ensureDirectories() {
    console.debug("Checking directories");
    OS.File.makeDir(this.dsPath);
    let libdsPath;
    if (AppConstants.platform === 'win') {
      libdsPath = OS.Path.join(this.dsPath, "libdeepspeech.dll");
    } else {
      libdsPath = OS.Path.join(this.dsPath, "libdeepspeech.so");
    }

    console.debug("Checking directories: " + libdsPath);
    return OS.File.exists(libdsPath).then(rv => {
      return rv;
    });
  },

  installedModels() {
    console.debug("Querying installed models");

    let modelsRoot = OS.Path.join(this.dsPath, "models");
    let models = new Array();
    let iterator = new OS.File.DirectoryIterator(modelsRoot);
    return iterator.forEach(entry => {
      console.debug("Querying installed models: entry=" + entry.name);
      if (entry.isDir) {
        let allChecks = [];

        for (let f in this.modelRequiredFiles) {
          let ef = OS.Path.join(modelsRoot, entry.name, this.modelRequiredFiles[f]);
          console.debug("Checking ef=" + ef);

          allChecks.push(OS.File.exists(ef).then(rv => {
            return rv;
          }));
        }

        let validDir = Promise.all(allChecks).then(rv => {
          console.debug('allChecks rv=' + rv);
          return rv.indexOf(false) == -1;
        });

        validDir.then(rv => {
          console.debug("Adding " + entry.name + " if " + rv);
          if (rv) {
            models.push(entry.name);
          }
        });
      }
    })
    .catch(ex => Cu.reportError(ex))
    .then(() => {
      console.debug("Populated: " + models);
      return models;
    });
  },

  downloadLib: async function() {
    // Create download and track its progress.
    this.setStatusMessage('Downloading library ...');
    try {
      const download = await Downloads.createDownload({
        source: this.libdeepspeechZip[AppConstants.platform],
        target: OS.Path.join(this.dsPath, "libdeepspeech.zip"),
      });
      const list = await Downloads.getList(Downloads.ALL);
      // add the download to the download list in the Downloads list in the Browser UI
      list.add(download);
      // Await successful completion of the save via the download manager
      await download.start();
    } catch (ex) {
      console.error(ex);
    }
  },

  extractLib: async function() {
    let zipFilePath = OS.Path.join(this.dsPath, "libdeepspeech.zip");
    let zipDirPath  = this.dsPath;
    let zipFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    zipFile.initWithPath(zipFilePath);
    let zipDir  = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    zipDir.initWithPath(zipDirPath);
    OS.File.makeDir(zipDirPath);
    console.debug('Extracting', zipFile, 'into', zipDir);
    this.setStatusMessage('Extracting library ...');
    await ZipUtils.extractFilesAsync(zipFile, zipDir);
    this.setStatusMessage('Extracted library, removing zip');
    OS.File.remove(zipFilePath);

    if (AppConstants.platform === 'win') {
      let soPath = OS.Path.join(this.dsPath, "libdeepspeech.so");
      let dllPath = OS.Path.join(this.dsPath, "libdeepspeech.dll");
      OS.File.move(soPath, dllPath);
    }
  },

  downloadModel: async function(model) {
    // Create download and track its progress.
    this.setStatusMessage('Downloading model ' + model + ' ...');
    OS.File.makeDir(OS.Path.join(this.dsPath, "models"));
    try {
      const download = await Downloads.createDownload({
        source: this.modelsZip[model],
        target: OS.Path.join(this.dsPath, "models", model + ".zip"),
      });
      const list = await Downloads.getList(Downloads.ALL);
      // add the download to the download list in the Downloads list in the Browser UI
      list.add(download);
      // Await successful completion of the save via the download manager
      await download.start();
    } catch (ex) {
      console.error(ex);
    }
  },

  extractModel: async function(model) {
    let zipFilePath = OS.Path.join(this.dsPath, "models", model + ".zip");
    let zipDirPath  = OS.Path.join(this.dsPath, "models", model);
    let zipFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    zipFile.initWithPath(zipFilePath);
    let zipDir  = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    zipDir.initWithPath(zipDirPath);
    OS.File.makeDir(zipDirPath);
    console.debug('Extracting', zipFile, 'into', zipDir);
    this.setStatusMessage('Extracting model ' + model + ' ...');
    await ZipUtils.extractFilesAsync(zipFile, zipDir);
    this.setStatusMessage('Extracted model ' + model + ', removing zip');
    OS.File.remove(zipFilePath);
  },
};

function showDownloadModels(existing) {
  console.debug('Showing all models', AboutDeepSpeech.modelsZip);
  console.debug('Showing existing models', existing);
  let root = document.getElementById('available-models');
  for (let model in AboutDeepSpeech.modelsZip) {
    if (existing.indexOf(model) >= 0) {
      continue;
    }

    console.debug('Adding model', model);
    let li = document.createElement('li');
    let downloadButton = document.createElement('input');
    downloadButton.type  = 'button';
    downloadButton.value = 'Install ' + model;
    downloadButton.addEventListener('click', () => {
      console.debug('Triggering download');
      AboutDeepSpeech.downloadModel(model).then(() => {
        console.debug('Finished download');
        AboutDeepSpeech.extractModel(model).then(() => {
          console.debug('Extracted model');
          window.location.reload();
        });
      });
    });
    li.appendChild(downloadButton);
    root.appendChild(li);
  }
}

function showDownloadLib() {
  let root = document.getElementById('generic-status');
  let downloadButton = document.createElement('input');
  downloadButton.type  = 'button';
  downloadButton.value = 'Install lib';
  downloadButton.addEventListener('click', () => {
    console.debug('Triggering download');
    AboutDeepSpeech.downloadLib().then(() => {
      console.debug('Finished download');
      AboutDeepSpeech.extractLib().then(() => {
        console.debug('Extracted library');
        window.location.reload();
      });
    });
  });
  root.appendChild(downloadButton);
}

function showCurrentModels(models) {
  console.debug('models', models);
  document.getElementById('loading-models').style.display = 'none';
  let root = document.getElementById('installed-models');
  for (let model in models) {
    let modelName = models[model];
    let e = document.createElement('li');
    let m = document.createElement('ol');
    m.id = 'parameters-model-' + modelName;
    e.appendChild(m);
    root.appendChild(e);
    AboutDeepSpeech.populateParameters(modelName);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  console.error('Loaded!!');
  document.getElementById('loading-models').style.display = 'inline';

  AboutDeepSpeech.handleStatus();

  AboutDeepSpeech.ensureDirectories().then(ok => {
    if (ok) {
      console.debug('Valid directory structure, checking models');
      AboutDeepSpeech.installedModels().then(models => {
        showDownloadModels(models);
        if (models.length > 0) {
          showCurrentModels(models);
        }
      });
    } else {
      AboutDeepSpeech.setStatusMessage('Invalid directory structure or missing libdeepspeech.so, please check deepspeech/ in your profile.');
      console.debug('Invalid directory structure, please install runtime');
      showDownloadLib();
    }
  });
});
