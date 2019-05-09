/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "SpeechDecoderModule.h"
#include "mozilla/Logging.h"
#include "mozilla/StaticPrefs_media.h"

namespace mozilla {

LogModule* GetSDMLog() {
  static LazyLogModule sLog("SpeechDecoderModule");
  return sLog;
}

#define SDM_LOG(...) \
  MOZ_LOG(GetSDMLog(), mozilla::LogLevel::Debug, (__VA_ARGS__))

bool SpeechDecoderModule::SupportsMimeType(
    const nsACString& aMimeType, DecoderDoctorDiagnostics* aDiagnostics) const {
  SDM_LOG("%s", __PRETTY_FUNCTION__);
  bool supports = aMimeType.EqualsLiteral("application/x-deepspeech");
  SDM_LOG("Speech decoder %s requested type ", supports ? "supports" : "rejects");
  return supports;
}

already_AddRefed<MediaDataDecoder> SpeechDecoderModule::CreateSpeechDecoder(
    const CreateDecoderParams& aParams) {
  SDM_LOG("%s", __PRETTY_FUNCTION__);

  if (!aParams.mUseSpeechDecoder.mUse) {
    SDM_LOG("%s unsupported type", __PRETTY_FUNCTION__);
    return nullptr;
  }

  SDM_LOG("%s returning child", __PRETTY_FUNCTION__);
  RefPtr<MediaDataDecoder> object = new DeepSpeechDecoder(aParams);
  return object.forget();
}

}  // namespace mozilla
