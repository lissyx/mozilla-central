/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DEEPSPEECH_DECODER_H
#define DEEPSPEECH_DECODER_H

#include "PlatformDecoderModule.h"

namespace mozilla {

LogModule* GetDSDLog() {
  static LazyLogModule sLog("DeepSpeechDecoder");
  return sLog;
}
#define DSD_LOG(...) \
  MOZ_LOG(GetDSDLog(), mozilla::LogLevel::Debug, (__VA_ARGS__))

DDLoggedTypeDeclNameAndBase(DeepSpeechDecoder, MediaDataDecoder);

class DeepSpeechDecoder : public MediaDataDecoder,
                        public DecoderDoctorLifeLogger<DeepSpeechDecoder> {
 public:
  explicit DeepSpeechDecoder(const CreateDecoderParams& aParams);

  RefPtr<InitPromise> Init() override;
  RefPtr<DecodePromise> Decode(MediaRawData* aSample) override;
  RefPtr<DecodePromise> Drain() override;
  RefPtr<FlushPromise> Flush() override;
  RefPtr<ShutdownPromise> Shutdown() override;
  nsCString GetDescriptionName() const override {
    return NS_LITERAL_CSTRING("deepspeech audio decoder");
  }

 private:
  RefPtr<DecodePromise> ProcessDecode(MediaRawData* aSample);
  const AudioInfo& mInfo;
  const RefPtr<TaskQueue> mTaskQueue;
};

}  // namespace mozilla

#endif
