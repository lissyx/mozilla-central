/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechDecoderModule.h"
#include "mozilla/Logging.h"
#include "mozilla/layers/SynchronousTask.h"
#include "mozilla/StaticPrefs_media.h"
#include "RemoteDecoderManagerChild.h"
#include "RemoteMediaDataDecoder.h"
#include "RemoteSpeechDecoder.h"
#include "mozilla/dom/ContentChild.h"  // for launching RDD w/ ContentChild

namespace mozilla {

LogModule* GetSDMLog() {
  static LazyLogModule sLog("SpeechDecoderModule");
  return sLog;
}

#define SDM_LOG(...) \
  MOZ_LOG(GetSDMLog(), mozilla::LogLevel::Debug, (__VA_ARGS__))

nsresult SpeechDecoderModule::Startup() {
  SDM_LOG("%s", __PRETTY_FUNCTION__);
  if (!RemoteDecoderManagerChild::GetManagerThread()) {
    return NS_ERROR_FAILURE;
  }
  return NS_OK;
}

bool SpeechDecoderModule::SupportsMimeType(
    const nsACString& aMimeType, DecoderDoctorDiagnostics* aDiagnostics) const {
  SDM_LOG("%s", __PRETTY_FUNCTION__);
  bool supports = true;
  SDM_LOG("Speech decoder %s requested type", supports ? "supports" : "rejects");
  return supports;
}

already_AddRefed<MediaDataDecoder> SpeechDecoderModule::CreateAudioDecoder(
    const CreateDecoderParams& aParams) {
  SDM_LOG("%s", __PRETTY_FUNCTION__);

  dom::ContentChild::GetSingleton()->LaunchRDDProcess();

  RefPtr<RemoteSpeechDecoderChild> child = new RemoteSpeechDecoderChild();
  layers::SynchronousTask task("InitIPDL");
  MediaResult result(NS_OK);
  RemoteDecoderManagerChild::GetManagerThread()->Dispatch(
      NS_NewRunnableFunction(
          "dom::SpeechDecoderModule::CreateAudioDecoder",
          [&, child]() {
          layers::AutoCompleteTask complete(&task);
            result = child->InitIPDL();
          }),
      NS_DISPATCH_NORMAL);
  task.Wait();

  if (NS_FAILED(result)) {
    SDM_LOG("%s result failure", __PRETTY_FUNCTION__);
    if (aParams.mError) {
      *aParams.mError = result;
    }
    return nullptr;
  }

  SDM_LOG("%s returning child", __PRETTY_FUNCTION__);
  RefPtr<RemoteMediaDataDecoder> object = new RemoteMediaDataDecoder(child);
  return object.forget();
}

}  // namespace mozilla
