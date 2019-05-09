/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef DEEPSPEECH_DECODER_H
#define DEEPSPEECH_DECODER_H

#include "PlatformDecoderModule.h"
#include "mozilla/SharedLibrary.h"

#ifndef DEEPSPEECH_API
#define DEEPSPEECH_API
#include "mozilla/deepspeech.h"
#endif // DEEPSPEECH_API

namespace mozilla {

DDLoggedTypeDeclNameAndBase(DeepSpeechDecoder, MediaDataDecoder);

class DeepSpeechDecoder : public MediaDataDecoder,
                        public DecoderDoctorLifeLogger<DeepSpeechDecoder> {
 public:
  explicit DeepSpeechDecoder(const CreateDecoderParams& aParams);
  ~DeepSpeechDecoder();

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

  const SpeechInfo& mInfo;
  const RefPtr<TaskQueue> mTaskQueue;

  ModelState* dsModel = nullptr;
  StreamingState* streamState = nullptr;

  /** libdeepspeech bindings **/
  PRLibrary* libdeepspeech_so = nullptr;

  int (*DS_CreateModel)(const char*, unsigned int, ModelState**) = nullptr;
  int (*DS_EnableDecoderWithLM)(ModelState*,const char*, const char*, float, float) = nullptr;
  int (*DS_GetModelSampleRate)(ModelState*) = nullptr;
  void (*DS_FreeModel)(ModelState*) = nullptr;

  int (*DS_CreateStream)(ModelState*, StreamingState**) = nullptr;
  void (*DS_FeedAudioContent)(StreamingState*, const short*, unsigned int) = nullptr;
  char* (*DS_IntermediateDecode)(StreamingState*) = nullptr;
  char* (*DS_FinishStream)(StreamingState*) = nullptr;
  Metadata* (*DS_FinishStreamWithMetadata)(StreamingState*) = nullptr;
  void (*DS_FreeStream)(StreamingState*) = nullptr;

  void (*DS_FreeString)(char*) = nullptr;
  void (*DS_FreeMetadata)(Metadata*) = nullptr;

  void (*DS_PrintVersions)(void) = nullptr;
  /** end of libdeespeech **/
};

}  // namespace mozilla

#endif
