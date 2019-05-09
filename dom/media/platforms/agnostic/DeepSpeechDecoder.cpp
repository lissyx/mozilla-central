/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "AudioSampleFormat.h"
#include "BufferReader.h"
#include "DeepSpeechDecoder.h"

namespace mozilla {

LogModule* GetDSDLog() {
  static LazyLogModule sLog("DeepSpeechDecoder");
  return sLog;
}
#define DSD_LOG(...) \
  MOZ_LOG(GetDSDLog(), mozilla::LogLevel::Debug, (__VA_ARGS__))

#define DS_SYM(varname)                                                               \
    DSD_LOG("%s binding symbol %s", __PRETTY_FUNCTION__, #varname"");                 \
    *(void**)(&varname) = (void*)PR_FindFunctionSymbol(libdeepspeech_so, #varname""); \
    if (!varname) {                                                                   \
        DSD_LOG("%s error PR_FindFunctionSymbol()", __PRETTY_FUNCTION__);             \
        PR_UnloadLibrary(libdeepspeech_so);                                           \
        return;                                                                       \
    }

#define DS_UNSYM(varname)                                               \
    DSD_LOG("%s unbinding symbol %s", __PRETTY_FUNCTION__, #varname""); \
    if (varname) {                                                      \
        varname = nullptr;                                              \
    }

DeepSpeechDecoder::DeepSpeechDecoder(const CreateDecoderParams& aParams)
    : mInfo(aParams.SpeechConfig()), mTaskQueue(aParams.mTaskQueue) {
  DSD_LOG("%s", __PRETTY_FUNCTION__);
  MOZ_ASSERT(mTaskQueue, "mTaskQueue should not be nullptr");

#ifdef XP_WIN
  DSD_LOG("%s loading libdeepspeech.so from '%s'", __PRETTY_FUNCTION__, mInfo.mLibFilename.get());
  libdeepspeech_so = LoadLibraryWithFlags(mInfo.mLibFilename.get(), 0);
#else
  DSD_LOG("%s loading libdeepspeech.so from '%s'", __PRETTY_FUNCTION__, NS_ConvertUTF16toUTF8(mInfo.mLibFilename).get());
  libdeepspeech_so = LoadLibraryWithFlags(NS_ConvertUTF16toUTF8(mInfo.mLibFilename).get(), 0);
#endif
  if (!libdeepspeech_so) {
    DSD_LOG("Unable to locate libdeepspeech, aborting");
    libdeepspeech_so = nullptr;
    return;
  }

  DS_SYM(DS_CreateModel);
  DS_SYM(DS_EnableDecoderWithLM);
  DS_SYM(DS_GetModelSampleRate);
  DS_SYM(DS_FreeModel);

  DS_SYM(DS_CreateStream);
  DS_SYM(DS_FeedAudioContent);
  DS_SYM(DS_IntermediateDecode);
  DS_SYM(DS_FinishStream);
  DS_SYM(DS_FinishStreamWithMetadata);
  DS_SYM(DS_FreeStream);

  DS_SYM(DS_FreeString);
  DS_SYM(DS_FreeMetadata);

  DS_SYM(DS_PrintVersions);

  DSD_LOG("%s loading model", __PRETTY_FUNCTION__);

  int status = DS_CreateModel(mInfo.mModelFilename.get(), mInfo.mBeamWidth, &dsModel);
  if (status != DS_ERR_OK) {
    DSD_LOG("Unable to load model");
    return;
  }

  if (!mInfo.mLmbinaryFilename.IsEmpty() && !mInfo.mLmtrieFilename.IsEmpty()) {
    int status = DS_EnableDecoderWithLM(dsModel, mInfo.mLmbinaryFilename.get(), mInfo.mLmtrieFilename.get(),
                                      mInfo.mLmAlpha, mInfo.mLmBeta);
    if (status != DS_ERR_OK) {
      DSD_LOG("Could not enable CTC decoder with LM.");
      return;
    }
  }
}

DeepSpeechDecoder::~DeepSpeechDecoder() {
  DSD_LOG("%s", __PRETTY_FUNCTION__);

  MOZ_ASSERT(!streamState, "Calling DeepSpeechDecoder destructor from unclean state");

  if (dsModel) {
    DS_FreeModel(dsModel);
    dsModel = nullptr;
  }

  DS_UNSYM(DS_CreateModel);
  DS_UNSYM(DS_EnableDecoderWithLM);
  DS_UNSYM(DS_GetModelSampleRate);
  DS_UNSYM(DS_FreeModel);

  DS_UNSYM(DS_CreateStream);
  DS_UNSYM(DS_FeedAudioContent);
  DS_UNSYM(DS_IntermediateDecode);
  DS_UNSYM(DS_FinishStream);
  DS_UNSYM(DS_FinishStreamWithMetadata);
  DS_UNSYM(DS_FreeStream);

  DS_UNSYM(DS_FreeString);
  DS_UNSYM(DS_FreeMetadata);

  DS_UNSYM(DS_PrintVersions);

  libdeepspeech_so = nullptr;
}

RefPtr<MediaDataDecoder::InitPromise> DeepSpeechDecoder::Init() {
  DSD_LOG("%s", __PRETTY_FUNCTION__);
  DSD_LOG("%s create stream", __PRETTY_FUNCTION__);

  int status = DS_CreateStream(dsModel, &streamState);
  if (status != DS_ERR_OK) {
    DSD_LOG("Unable to setup streaming context.");
    return InitPromise::CreateAndReject(
      MediaResult(NS_ERROR_FAILURE, __func__), __func__);
  }

  return InitPromise::CreateAndResolve(TrackInfo::kAudioTrack, __func__);
}

RefPtr<MediaDataDecoder::DecodePromise> DeepSpeechDecoder::Decode(
    MediaRawData* aSample) {
  // DSD_LOG("%s", __PRETTY_FUNCTION__);
  // DSD_LOG("%s received aSample %ld bytes", __PRETTY_FUNCTION__, aSample->Size());
  return InvokeAsync<MediaRawData*>(mTaskQueue, this, __func__,
                                    &DeepSpeechDecoder::ProcessDecode, aSample);
}

RefPtr<MediaDataDecoder::DecodePromise> DeepSpeechDecoder::ProcessDecode(
    MediaRawData* aSample) {
  // DSD_LOG("%s", __PRETTY_FUNCTION__);
  // DSD_LOG("%s received aSample %ld bytes", __PRETTY_FUNCTION__, aSample->Size());

  size_t buffer_length = aSample->Size();
  if (!buffer_length) {
    return DecodePromise::CreateAndReject(
        MediaResult(NS_ERROR_OUT_OF_MEMORY, __func__), __func__);
  }

  const short* buffer = reinterpret_cast<const short *>(aSample->Data());
  if (!buffer) {
    return DecodePromise::CreateAndReject(
        MediaResult(NS_ERROR_OUT_OF_MEMORY, __func__), __func__);
  }

  DS_FeedAudioContent(streamState, buffer, buffer_length);

  return DecodePromise::CreateAndResolve(
      DecodedData(),
      __func__);
}

RefPtr<MediaDataDecoder::DecodePromise> DeepSpeechDecoder::Drain() {
  DSD_LOG("%s", __PRETTY_FUNCTION__);

  return InvokeAsync(mTaskQueue, __func__,
    [self = RefPtr<DeepSpeechDecoder>(this), streamState = streamState] {
      DSD_LOG("%s Promise", __PRETTY_FUNCTION__);

      nsString sttResult;
      float sttConfidence;

      Metadata* result = self->DS_FinishStreamWithMetadata(streamState);
      for (int i = 0; i < result->num_items; ++i) {
        MetadataItem mi = result->items[i];
        sttResult += NS_ConvertUTF8toUTF16(mi.character);
      }
      sttConfidence = result->confidence;
      self->DS_FreeMetadata(result);

      DSD_LOG("%s Promise(sttResult=%s, sttConfidence=%f)", __PRETTY_FUNCTION__, NS_ConvertUTF16toUTF8(sttResult).get(), sttConfidence);
      DecodedData inferenceResults;
      RefPtr<MediaData> inferenceResult = new SpeechData(sttResult, sttConfidence);
      inferenceResults.AppendElement(inferenceResult);
      return DecodePromise::CreateAndResolve(std::move(inferenceResults), __func__);
  });
}

RefPtr<MediaDataDecoder::FlushPromise> DeepSpeechDecoder::Flush() {
  DSD_LOG("%s", __PRETTY_FUNCTION__);
  return InvokeAsync(mTaskQueue, __func__, []() {
    return FlushPromise::CreateAndResolve(true, __func__);
  });
}

RefPtr<ShutdownPromise> DeepSpeechDecoder::Shutdown() {
  DSD_LOG("%s", __PRETTY_FUNCTION__);
  DSD_LOG("%s finish stream", __PRETTY_FUNCTION__);

  RefPtr<DeepSpeechDecoder> self = this;

  DS_FreeStream(streamState);
  streamState = nullptr;

  return InvokeAsync(mTaskQueue, __func__, [self]() {
    return ShutdownPromise::CreateAndResolve(true, __func__);
  });
}

}
