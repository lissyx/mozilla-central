/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  LegacyWorkersWatcher,
} = require("devtools/shared/resources/legacy-target-watchers/legacy-workers-watcher");

class LegacyServiceWorkersWatcher extends LegacyWorkersWatcher {
  _supportWorkerTarget(workerTarget) {
    return workerTarget.isServiceWorker;
  }
}

module.exports = { LegacyServiceWorkersWatcher };
