/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#include "RemoteSpeechDecoder.h"
#include "MediaInfo.h"
#include "PDMFactory.h"
#include "RemoteDecoderManagerChild.h"
#include "RemoteDecoderManagerParent.h"
#include "mozilla/StaticPrefs_media.h"
#include "mozilla/Telemetry.h"

namespace mozilla {

LogModule* GetRSDLog() {
  static LazyLogModule sLog("RemoteSpeechDecoder");
  return sLog;
}

#define RSD_LOG(...) \
  MOZ_LOG(GetRSDLog(), mozilla::LogLevel::Debug, (__VA_ARGS__))

using namespace ipc;

RemoteSpeechDecoderChild::RemoteSpeechDecoderChild(bool aRecreatedOnCrash)
    : RemoteDecoderChild(aRecreatedOnCrash) {
  RSD_LOG("%s", __PRETTY_FUNCTION__);
}

RemoteSpeechDecoderChild::RemoteSpeechDecoderChild()
    : RemoteSpeechDecoderChild(true) {
  RSD_LOG("%s", __PRETTY_FUNCTION__);
}

MediaResult RemoteSpeechDecoderChild::ProcessOutput(
    const DecodedOutputIPDL& aDecodedData) {
  RSD_LOG("%s", __PRETTY_FUNCTION__);

  AssertOnManagerThread();
  MOZ_ASSERT(aDecodedData.type() ==
             DecodedOutputIPDL::TArrayOfRemoteSpeechDataIPDL);

  return NS_OK;
}

MediaResult RemoteSpeechDecoderChild::InitIPDL() {
  RSD_LOG("%s", __PRETTY_FUNCTION__);

  RefPtr<RemoteDecoderManagerChild> manager =
      RemoteDecoderManagerChild::GetRDDProcessSingleton();

  // The manager isn't available because RemoteDecoderManagerChild has been
  // initialized with null end points and we don't want to decode video on RDD
  // process anymore. Return false here so that we can fallback to other PDMs.
  if (!manager) {
    RSD_LOG("%s !manager", __PRETTY_FUNCTION__);
    return MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                       RESULT_DETAIL("RemoteDecoderManager is not available."));
  }

  if (!manager->CanSend()) {
    RSD_LOG("%s !manager->CanSend()", __PRETTY_FUNCTION__);
    return MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR,
                       RESULT_DETAIL("RemoteDecoderManager unable to send."));
  }

  RSD_LOG("%s should return success", __PRETTY_FUNCTION__);
  bool success = true;
  return success ? MediaResult(NS_OK)
                 : MediaResult(NS_ERROR_DOM_MEDIA_FATAL_ERR, RESULT_DETAIL("lol"));
}

RemoteSpeechDecoderParent::RemoteSpeechDecoderParent(
    RemoteDecoderManagerParent* aParent, TaskQueue* aManagerTaskQueue,
    TaskQueue* aDecodeTaskQueue, nsCString* aErrorDescription)
    : RemoteDecoderParent(aParent, aManagerTaskQueue, aDecodeTaskQueue) {
  RSD_LOG("%s", __PRETTY_FUNCTION__);
}

MediaResult RemoteSpeechDecoderParent::ProcessDecodedData(
    const MediaDataDecoder::DecodedData& aData,
    DecodedOutputIPDL& aDecodedData) {
  RSD_LOG("%s", __PRETTY_FUNCTION__);
  MOZ_ASSERT(OnManagerThread());
  return NS_OK;
}

}  // namespace mozilla
