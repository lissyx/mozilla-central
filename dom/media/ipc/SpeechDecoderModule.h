/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef SpeechDecoderModule_h_
#define SpeechDecoderModule_h_

#include "PlatformDecoderModule.h"

namespace mozilla {

class SpeechDecoderModule : public PlatformDecoderModule {
 public:
  explicit SpeechDecoderModule() {}

  nsresult Startup() override;

  bool SupportsMimeType(const nsACString& aMimeType,
                        DecoderDoctorDiagnostics* aDiagnostics) const override;

  already_AddRefed<MediaDataDecoder> CreateVideoDecoder(
      const CreateDecoderParams& aParams) override {
    return nullptr;
  }

  already_AddRefed<MediaDataDecoder> CreateAudioDecoder(
      const CreateDecoderParams& aParams) override;
};

}  // namespace mozilla

#endif /* SpeechDecoderModule_h_ */
