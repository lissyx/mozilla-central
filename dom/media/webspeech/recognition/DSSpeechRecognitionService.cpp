/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsThreadUtils.h"

#include "DSSpeechRecognitionService.h"

#include "SpeechRecognition.h"
#include "SpeechRecognitionAlternative.h"
#include "SpeechRecognitionResult.h"
#include "SpeechRecognitionResultList.h"

#include "nsIObserverService.h"
#include "nsIFileStreams.h"
#include "nsNetCID.h"
#include "nsStreamUtils.h"
#include "json/json.h"

#include "mozilla/Services.h"
#include "mozilla/StaticPrefs_media.h"
#include "mozilla/gfx/gfxVars.h"

#include "MediaData.h"
#include "MediaInfo.h"
#include "MediaSegment.h"
#include "VideoUtils.h"  // for MediaThreadType

namespace mozilla {

using namespace dom;

LogModule* GetDSLog() {
  static LazyLogModule sLog("DeepSpeech");
  return sLog;
}
#define DS_LOG(...) \
  MOZ_LOG(GetDSLog(), mozilla::LogLevel::Debug, (__VA_ARGS__))

#define PREFERENCE_DEEPSPEECH_ENABLED "media.webspeech.service.deepspeech.enabled"
#define PREFERENCE_DEEPSPEECH_DEBUG_DIR "media.webspeech.service.deepspeech.debug_dir"

#define DEEPSPEECH_BITS 16
#define DEEPSPEECH_SAMPLE_RATE 16000
#define DEEPSPEECH_CHANNELS 1

NS_IMPL_ISUPPORTS(DSSpeechRecognitionService, nsISpeechRecognitionService,
                  nsIObserver)

DSSpeechRecognitionService::DSSpeechRecognitionService() {
  // MOZ_RELEASE_ASSERT(NS_IsMainThread());

  nsCOMPtr<nsIObserverService> obsSvc = services::GetObserverService();
  if (obsSvc) {
    obsSvc->AddObserver(this, "xpcom-shutdown", false);
  }
}

void
DSSpeechRecognitionService::SetLang(const nsAString& aLang) {
  DS_LOG("%s aLang=%s", __PRETTY_FUNCTION__, NS_ConvertUTF16toUTF8(aLang).get());

  bool isEnabled = Preferences::GetBool(PREFERENCE_DEEPSPEECH_ENABLED);
  if (!isEnabled) {
    return;
  }

  // Website can request any lang, we should have a mapping here
  // Also force lower case. Google Docs, for example, sets 'en-us'
  ToLowerCase(aLang, mLang);

  nsAutoString profileDirPath(gfx::gfxVars::ProfDirectory());
  DS_LOG("%s read profileDirPath=%s", __PRETTY_FUNCTION__, NS_ConvertUTF16toUTF8(profileDirPath).get());

  nsresult rv = NS_OK;
  nsCOMPtr<nsIFile> profileDir(do_CreateInstance(NS_LOCAL_FILE_CONTRACTID, &rv));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to create profile dir");
    return;
  }
  profileDir->InitWithPath(profileDirPath);
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to init profile dir %s", NS_ConvertUTF16toUTF8(profileDirPath).get());
    return;
  }

  ////////// modelDir

  nsCOMPtr<nsIFile> modelDir;
  rv = profileDir->Clone(getter_AddRefs(modelDir));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to clone into modelDir");
    return;
  }
  rv = modelDir->AppendNative(NS_LITERAL_CSTRING("deepspeech"));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append deepspeech to modelDir");
    return;
  }

  ////////// libFilename

  nsCOMPtr<nsIFile> _libFilename;
  rv = modelDir->Clone(getter_AddRefs(_libFilename));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to clone into _libFilename");
    return;
  }
#ifdef XP_WIN
  rv = _libFilename->AppendNative(NS_LITERAL_CSTRING("libdeepspeech.dll"));
#else
  rv = _libFilename->AppendNative(NS_LITERAL_CSTRING("libdeepspeech.so"));
#endif
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append soname to _libFilename");
    return;
  }
  nsString libFilename;
  rv = _libFilename->GetPath(libFilename);
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to GetPath from_libFilename");
    return;
  }

  ////////// modelRoot

  nsCOMPtr<nsIFile> modelRoot;
  rv = modelDir->Clone(getter_AddRefs(modelRoot));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to clone into modelRoot");
    return;
  }
  rv = modelRoot->AppendNative(NS_LITERAL_CSTRING("models"));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append models to modelRoot");
    return;
  }
  rv = modelRoot->Append(mLang);
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append lang to modelRoot");
    return;
  }

  ////////// jsonDesc

  nsCOMPtr<nsIFile> jsonDesc;
  rv = modelRoot->Clone(getter_AddRefs(jsonDesc));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to create JSON file");
    return;
  }
  rv = jsonDesc->AppendNative(NS_LITERAL_CSTRING("info.json"));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append JSON file");
    return;
  }

  nsCOMPtr<nsIFileInputStream> fis(do_CreateInstance(NS_LOCALFILEINPUTSTREAM_CONTRACTID, &rv));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to create file input JSON file");
    return;
  }
  rv = fis->Init(jsonDesc, -1, -1, false);
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to init JSON file");
    return;
  }

  nsAutoCString jsonContent;
  NS_ConsumeStream(fis, UINT32_MAX, jsonContent);
  fis->Close();

  DS_LOG("JSON: '%s'", jsonContent.get());

  Json::Value root;
  Json::CharReaderBuilder builder;
  std::unique_ptr<Json::CharReader> const reader(builder.newCharReader());

  //////// modelFilename

  nsCOMPtr<nsIFile> _modelFilename;
  rv = modelRoot->Clone(getter_AddRefs(_modelFilename));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to clone into _modelFilename");
    return;
  }
  rv = _modelFilename->AppendNative(NS_LITERAL_CSTRING("output_graph.tflite"));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append soname to _modelFilename");
    return;
  }
  nsString modelFilename;
  rv = _modelFilename->GetPath(modelFilename);
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to GetPath from_modelFilename");
    return;
  }

  //////// lmbinaryFilename

  nsCOMPtr<nsIFile> _lmbinaryFilename;
  rv = modelRoot->Clone(getter_AddRefs(_lmbinaryFilename));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to clone into _lmbinaryFilename");
    return;
  }
  rv = _lmbinaryFilename->AppendNative(NS_LITERAL_CSTRING("lm.binary"));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append soname to _lmbinaryFilename");
    return;
  }
  nsString lmbinaryFilename;
  rv = _lmbinaryFilename->GetPath(lmbinaryFilename);
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to GetPath from_lmbinaryFilename");
    return;
  }

  //////// lmtrieFilename

  nsCOMPtr<nsIFile> _lmtrieFilename;
  rv = modelRoot->Clone(getter_AddRefs(_lmtrieFilename));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to clone into _lmtrieFilename");
    return;
  }
  rv = _lmtrieFilename->AppendNative(NS_LITERAL_CSTRING("trie"));
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to append soname to _lmtrieFilename");
    return;
  }
  nsString lmtrieFilename;
  rv = _lmtrieFilename->GetPath(lmtrieFilename);
  if (NS_FAILED(rv)) {
    DS_LOG("Unable to GetPath from_lmtrieFilename");
    return;
  }

  if (!reader->parse(jsonContent.BeginReading(), jsonContent.EndReading(), &root, nullptr)) {
    DS_LOG("Unable to parse JSON content");
    return;
  }

  DS_LOG("Loading parameters from JSON for '%s'", root["name"].asCString());

  int beamWidth = root["parameters"]["beamWidth"].asInt();
  float lmAlpha = root["parameters"]["lmAlpha"].asDouble();
  float lmBeta  = root["parameters"]["lmBeta"].asDouble();

  Preferences::GetCString(PREFERENCE_DEEPSPEECH_DEBUG_DIR, mDebugDir);

  DS_LOG("%s=%s", "PREFERENCE_DEEPSPEECH_LIB_FILENAME", NS_ConvertUTF16toUTF8(libFilename).get());
  DS_LOG("%s=%s", "PREFERENCE_DEEPSPEECH_MODEL_FILENAME", NS_ConvertUTF16toUTF8(modelFilename).get());
  DS_LOG("%s=%s", "PREFERENCE_DEEPSPEECH_LMBINARY_FILENAME", NS_ConvertUTF16toUTF8(lmbinaryFilename).get());
  DS_LOG("%s=%s", "PREFERENCE_DEEPSPEECH_LMTRIE_FILENAME", NS_ConvertUTF16toUTF8(lmtrieFilename).get());
  DS_LOG("%s=%d", "PREFERENCE_DEEPSPEECH_BEAM_WIDTH", beamWidth);
  DS_LOG("%s=%f", "PREFERENCE_DEEPSPEECH_LM_ALPHA", lmAlpha);
  DS_LOG("%s=%f", "PREFERENCE_DEEPSPEECH_LM_BETA", lmBeta);
  DS_LOG("%s=%s", "PREFERENCE_DEEPSPEECH_DEBUG_DIR", mDebugDir.get());

  SpeechInfo mSpeech;
  mSpeech.mMimeType = NS_LITERAL_CSTRING("application/x-deepspeech");
  mSpeech.mLibFilename      = libFilename;
  mSpeech.mModelFilename    = NS_ConvertUTF16toUTF8(modelFilename);
  mSpeech.mLmbinaryFilename = NS_ConvertUTF16toUTF8(lmbinaryFilename);
  mSpeech.mLmtrieFilename   = NS_ConvertUTF16toUTF8(lmtrieFilename);
  mSpeech.mBeamWidth = beamWidth;
  mSpeech.mLmAlpha   = lmAlpha;
  mSpeech.mLmBeta    = lmBeta;

  mPlatform = new PDMFactory();
  mTaskQueue = new TaskQueue(GetMediaThreadPool(MediaThreadType::PLATFORM_DECODER), "DeepSpeechDecoder::mTaskQueue");
  const CreateDecoderParams mParams(mSpeech, CreateDecoderParams::UseSpeechDecoder(true), mTaskQueue);
  mDecoder = mPlatform->CreateDecoder(mParams);
  MOZ_ASSERT(mDecoder);
  mDecoder->Init();

  return;
}

void
DSSpeechRecognitionService::ReleaseThreads() {
  DS_LOG("%s", __PRETTY_FUNCTION__);
}

DSSpeechRecognitionService::~DSSpeechRecognitionService() {
  DS_LOG("%s", __PRETTY_FUNCTION__);
  ReleaseThreads();
}

NS_IMETHODIMP
DSSpeechRecognitionService::Initialize(
    WeakPtr<SpeechRecognition> aSpeechRecognition) {
  MOZ_ASSERT(NS_IsMainThread());
  DS_LOG("%s", __PRETTY_FUNCTION__);
  mRecognition = new nsMainThreadPtrHolder<SpeechRecognition>(
      "DSSpeechRecognitionService::mRecognition", aSpeechRecognition);
  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::ProcessAudioSegment(AudioSegment* aAudioSegment,
                                                  int32_t aSampleRate) {
  DS_LOG("%s", __PRETTY_FUNCTION__);
  MOZ_ASSERT(!NS_IsMainThread());

  uint32_t aChannels = aAudioSegment->MaxChannelCount();

  if (aChannels > DEEPSPEECH_CHANNELS) {
    DS_LOG("Invalid number of channels %d", aChannels);
    return NS_OK;
  }

  if (aSampleRate != DEEPSPEECH_SAMPLE_RATE) {
    nsAutoRef<SpeexResamplerState> aResampler;
    if (!mResampler) {
      int error;
      mResampler = speex_resampler_init(DEEPSPEECH_CHANNELS, aSampleRate, DEEPSPEECH_SAMPLE_RATE,
                                        SPEEX_RESAMPLER_QUALITY_DEFAULT, &error);

      if (error != RESAMPLER_ERR_SUCCESS) {
        NS_WARNING("Failed to initialize resampler.");
        return NS_ERROR_FAILURE;
      }
    }

    aResampler.own(mResampler);
    aAudioSegment->Resample<short>(aResampler, &aChannels, aSampleRate, DEEPSPEECH_SAMPLE_RATE);
    mResampler = aResampler.disown();
  }

  // Requires mDebugDir **and** MOZ_DUMP_AUDIO=1
  if (!mDebugDir.IsEmpty()) {
    if (!mDebugWAV) {
      nsAutoCString debugWAVPath = mDebugDir + NS_LITERAL_CSTRING("/debug");
      mDebugWAV = new WavDumper();
      mDebugWAV->Open(debugWAVPath.get(), aChannels, DEEPSPEECH_SAMPLE_RATE);
    }
  }

  for (AudioSegment::ChunkIterator ci(*aAudioSegment); !ci.IsEnded(); ci.Next()) {
    AudioChunk& c = *ci;
    size_t buffer_length = c.GetDuration();

    short* buffer = new short[buffer_length];
    const short* orig = c.ChannelData<short>()[0];
    for (size_t i = 0; i < buffer_length; ++i) {
      buffer[i] = orig[i];
    }

    if (mDebugWAV) {
      mDebugWAV->Write(static_cast<const short *>(buffer), buffer_length);
    }

    RefPtr<MediaRawData> frame = new MediaRawData();
    UniquePtr<MediaRawDataWriter> frameWriter(frame->CreateWriter());
    if (!frameWriter->SetSize(buffer_length)) {
      MOZ_CRASH("failed to set MediaRawData size");
    }

    if (!frameWriter->Replace(reinterpret_cast<const uint8_t *>(buffer), buffer_length)) {
      MOZ_CRASH("failed to copy to MediaRawData");
    }

    // DS_LOG("%s sending %ld bytes from %ld bytes", __PRETTY_FUNCTION__, frame->Size(), buffer_length);
    mDecoder->Decode(frame);
  }

  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::SoundEnd() {
  DS_LOG("%s", __PRETTY_FUNCTION__);
  MOZ_ASSERT(NS_IsMainThread());

  if (mDebugWAV) {
    delete mDebugWAV;
    mDebugWAV = nullptr;
  }

  mDecoder->Drain()->Then(GetCurrentThreadSerialEventTarget(), __func__,
      [self = RefPtr<DSSpeechRecognitionService>(this)] (const nsTArray<RefPtr<MediaData>>& aResults) {
          for(size_t i = 0; i < aResults.Length(); i++) {
              RefPtr<SpeechData> aResult = aResults[i]->As<SpeechData>();
              DS_LOG("%s mDecoder->Drain() Promise success: (aResult->mConfidence=%f, aResult->mTranscription=%s)",
                     __PRETTY_FUNCTION__,
                     aResult->mConfidence,
                     NS_ConvertUTF16toUTF8(aResult->mTranscription).get());
              self->SendEvent(aResult->mTranscription, aResult->mConfidence);
          }
      },
      [self = RefPtr<DSSpeechRecognitionService>(this)] (const MediaResult& aError) {
          DS_LOG("%s mDecoder->Drain() Promise error", __PRETTY_FUNCTION__);
      });

  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::ValidateAndSetGrammarList(
    mozilla::dom::SpeechGrammar*, nsISpeechGrammarCompilationCallback*) {
  DS_LOG("%s", __PRETTY_FUNCTION__);
  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::Abort() {
  DS_LOG("%s", __PRETTY_FUNCTION__);
  ReleaseThreads();
  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::Observe(nsISupports* aSubject, const char* aTopic,
                                      const char16_t* aData) {
  DS_LOG("%s", __PRETTY_FUNCTION__);
  MOZ_ASSERT(strcmp(aTopic, "xpcom-shutdown") == 0, "Unexpected topic");
  ReleaseThreads();
  return NS_OK;
}

void
DSSpeechRecognitionService::SendEvent(nsString sttResult, float sttConfidence)
{
  DS_LOG("%s sttResult=%s", __PRETTY_FUNCTION__, NS_ConvertUTF16toUTF8(sttResult).get());
  RefPtr<SpeechEvent> event = new SpeechEvent(
      mRecognition, SpeechRecognition::EVENT_RECOGNITIONSERVICE_FINAL_RESULT);
  event->mRecognitionResultList = BuildResultList(sttResult, sttConfidence);
  NS_DispatchToMainThread(event);
}

SpeechRecognitionResultList*
DSSpeechRecognitionService::BuildResultList(nsString sttResult, float sttConfidence) {
  DS_LOG("%s", __PRETTY_FUNCTION__);

  SpeechRecognitionResultList* resultList =
      new SpeechRecognitionResultList(mRecognition);
  SpeechRecognitionResult* result = new SpeechRecognitionResult(mRecognition);
  if (0 < mRecognition->MaxAlternatives()) {
    SpeechRecognitionAlternative* alternative =
        new SpeechRecognitionAlternative(mRecognition);

    alternative->mTranscript = sttResult;
    alternative->mConfidence = sttConfidence;

    result->mItems.AppendElement(alternative);
  }
  resultList->mItems.AppendElement(result);

  return resultList;
}

}  // namespace mozilla
