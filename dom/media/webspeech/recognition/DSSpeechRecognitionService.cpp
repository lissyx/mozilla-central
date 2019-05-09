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
#include "mozilla/Services.h"
#include "mozilla/StaticPrefs.h"

#include "MediaSegment.h"

namespace mozilla {

using namespace dom;

LogModule* GetDSLog() {
  static LazyLogModule sLog("DeepSpeech");
  return sLog;
}
#define DS_LOG(...) \
  MOZ_LOG(GetDSLog(), mozilla::LogLevel::Debug, (__VA_ARGS__))

#define PREFERENCE_DEEPSPEECH_MODEL_FILENAME "media.webspeech.service.deepspeech.model"
#define PREFERENCE_DEEPSPEECH_ALPHABET_FILENAME "media.webspeech.service.deepspeech.alphabet"
#define PREFERENCE_DEEPSPEECH_LMBINARY_FILENAME "media.webspeech.service.deepspeech.lmbinary"
#define PREFERENCE_DEEPSPEECH_LMTRIE_FILENAME "media.webspeech.service.deepspeech.lmtrie"

#define PREFERENCE_DEEPSPEECH_N_CEP "media.webspeech.service.deepspeech.ncep"
#define PREFERENCE_DEEPSPEECH_N_CONTEXT "media.webspeech.service.deepspeech.ncontext"
#define PREFERENCE_DEEPSPEECH_BEAM_WIDTH "media.webspeech.service.deepspeech.beamwidth"
#define PREFERENCE_DEEPSPEECH_LM_ALPHA "media.webspeech.service.deepspeech.lmalpha"
#define PREFERENCE_DEEPSPEECH_LM_BETA "media.webspeech.service.deepspeech.lmbeta"

#define DEEPSPEECH_BITS 16
#define DEEPSPEECH_SAMPLE_RATE 16000
#define DEEPSPEECH_CHANNELS 1

NS_IMPL_ISUPPORTS(DSSpeechRecognitionService, nsISpeechRecognitionService,
                  nsIObserver)

DSSpeechRecognitionService::DSSpeechRecognitionService() {
  if (libdeepspeech_so == nullptr) {
    DS_LOG("%s loading libdeepspeech.so", __PRETTY_FUNCTION__);

    libdeepspeech_so = dlopen("libdeepspeech.so", RTLD_LAZY);
    if (!libdeepspeech_so) {
      DS_LOG("Unable to locate libdeepspeech.so, aborting");
      return; // NS_ERROR_FAILURE;
    }

    // Cleanup dlerror()
    dlerror();

    DS_SYM(DS_CreateModel);
    DS_SYM(DS_EnableDecoderWithLM);
    DS_SYM(DS_DestroyModel);

    DS_SYM(DS_SetupStream);
    DS_SYM(DS_FeedAudioContent);
    DS_SYM(DS_IntermediateDecode);
    DS_SYM(DS_FinishStream);
    DS_SYM(DS_DiscardStream);

    DS_SYM(DS_FreeString);

    DS_SYM(DS_PrintVersions);
  }

  nsAutoCString modelFilename;    Preferences::GetCString(PREFERENCE_DEEPSPEECH_MODEL_FILENAME,    modelFilename);
  nsAutoCString alphabetFilename; Preferences::GetCString(PREFERENCE_DEEPSPEECH_ALPHABET_FILENAME, alphabetFilename);
  nsAutoCString lmbinaryFilename; Preferences::GetCString(PREFERENCE_DEEPSPEECH_LMBINARY_FILENAME, lmbinaryFilename);
  nsAutoCString lmtrieFilename;   Preferences::GetCString(PREFERENCE_DEEPSPEECH_LMTRIE_FILENAME,   lmtrieFilename);
  int nCep      = Preferences::GetInt(PREFERENCE_DEEPSPEECH_N_CEP);
  int nContext  = Preferences::GetInt(PREFERENCE_DEEPSPEECH_N_CONTEXT);
  int beamWidth = Preferences::GetInt(PREFERENCE_DEEPSPEECH_BEAM_WIDTH);
  float lmAlpha = Preferences::GetFloat(PREFERENCE_DEEPSPEECH_LM_ALPHA);
  float lmBeta  = Preferences::GetFloat(PREFERENCE_DEEPSPEECH_LM_BETA);

  DS_LOG("%s=%s", PREFERENCE_DEEPSPEECH_MODEL_FILENAME, modelFilename.get());
  DS_LOG("%s=%s", PREFERENCE_DEEPSPEECH_ALPHABET_FILENAME, alphabetFilename.get());
  DS_LOG("%s=%s", PREFERENCE_DEEPSPEECH_LMBINARY_FILENAME, lmbinaryFilename.get());
  DS_LOG("%s=%s", PREFERENCE_DEEPSPEECH_LMTRIE_FILENAME, lmtrieFilename.get());
  DS_LOG("%s=%d", PREFERENCE_DEEPSPEECH_N_CEP, nCep);
  DS_LOG("%s=%d", PREFERENCE_DEEPSPEECH_N_CONTEXT, nContext);
  DS_LOG("%s=%d", PREFERENCE_DEEPSPEECH_BEAM_WIDTH, beamWidth);
  DS_LOG("%s=%f", PREFERENCE_DEEPSPEECH_LM_ALPHA, lmAlpha);
  DS_LOG("%s=%f", PREFERENCE_DEEPSPEECH_LM_BETA, lmBeta);

  int status = DS_CreateModel(modelFilename.get(), nCep, nContext, alphabetFilename.get(), beamWidth, &dsModel);
  if (status != DS_ERR_OK) {
    DS_LOG("Unable to load model");
    return; // NS_ERROR_FAILURE;
  }

  if (!lmbinaryFilename.IsEmpty() && !lmtrieFilename.IsEmpty()) {
    int status = DS_EnableDecoderWithLM(dsModel, alphabetFilename.get(),
                                      lmbinaryFilename.get(), lmtrieFilename.get(),
                                      lmAlpha, lmBeta);
    if (status != DS_ERR_OK) {
      DS_LOG("Could not enable CTC decoder with LM.");
      return; // NS_ERROR_FAILURE;
    }
  }
}

DSSpeechRecognitionService::~DSSpeechRecognitionService() {
  MOZ_ASSERT(libdeepspeech_so != nullptr, "libdeepspeech.so bindings should not be nullptr");
  MOZ_ASSERT(dsModel != nullptr, "There should have been a model loaded");

  DS_DestroyModel(dsModel);

  DS_UNSYM(DS_CreateModel);
  DS_UNSYM(DS_EnableDecoderWithLM);
  DS_UNSYM(DS_DestroyModel);

  DS_UNSYM(DS_SetupStream);
  DS_UNSYM(DS_FeedAudioContent);
  DS_UNSYM(DS_IntermediateDecode);
  DS_UNSYM(DS_FinishStream);
  DS_UNSYM(DS_DiscardStream);

  DS_UNSYM(DS_FreeString);

  DS_UNSYM(DS_PrintVersions);

  libdeepspeech_so = nullptr;
}

NS_IMETHODIMP
DSSpeechRecognitionService::Initialize(
    WeakPtr<SpeechRecognition> aSpeechRecognition) {
  DS_LOG("%s", __PRETTY_FUNCTION__);
  mRecognition = aSpeechRecognition;

  // debugWAV = fopen("/tmp/debug.wav", "w+");

  int status = DS_SetupStream(dsModel, 150, DEEPSPEECH_SAMPLE_RATE, &streamState);
  if (status != DS_ERR_OK) {
      DS_LOG("Unable to setup streaming context.");
      return NS_ERROR_FAILURE;
  }

  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::ProcessAudioSegment(AudioSegment* aAudioSegment,
                                                  int32_t aSampleRate) {
  int32_t aChannels = aAudioSegment->ChannelCount();

  if (aChannels > DEEPSPEECH_CHANNELS) {
    DS_LOG("Invalid number of channels %d", aChannels);
    return NS_OK;
  }

  if (aSampleRate != DEEPSPEECH_SAMPLE_RATE) {
    if (!mResampler) {
      int error;
      mResampler = speex_resampler_init(DEEPSPEECH_CHANNELS, aSampleRate, DEEPSPEECH_SAMPLE_RATE,
                                        SPEEX_RESAMPLER_QUALITY_DEFAULT, &error);

      if (error != RESAMPLER_ERR_SUCCESS) {
        NS_WARNING("Failed to initialize resampler.");
        return NS_ERROR_FAILURE;
      }
    }

    aAudioSegment->Resample<short>(mResampler, aSampleRate, DEEPSPEECH_SAMPLE_RATE);
  }

  for (AudioSegment::ChunkIterator ci(*aAudioSegment); !ci.IsEnded(); ci.Next()) {
    AudioChunk& c = *ci;
    const short* buffer = c.ChannelData<short>()[0];
    // size_t wrote = fwrite(buffer, sizeof(short), c.GetDuration(), debugWAV);
    DS_FeedAudioContent(streamState, buffer, c.GetDuration());
  }

  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::SoundEnd() {
  DS_LOG("%s", __PRETTY_FUNCTION__);

  // fclose(debugWAV);

  char* sttResult = DS_FinishStream(streamState);

  DS_LOG("%s sttResult=%s", __PRETTY_FUNCTION__, sttResult);

  RefPtr<SpeechEvent> event = new SpeechEvent(
      mRecognition, SpeechRecognition::EVENT_RECOGNITIONSERVICE_FINAL_RESULT);

  event->mRecognitionResultList = BuildResultList(sttResult);
  NS_DispatchToMainThread(event);

  DS_FreeString(sttResult);

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
  DS_DiscardStream(streamState);
  return NS_OK;
}

NS_IMETHODIMP
DSSpeechRecognitionService::Observe(nsISupports* aSubject, const char* aTopic,
                                      const char16_t* aData) {
  DS_LOG("%s", __PRETTY_FUNCTION__);

  const nsDependentString eventName = nsDependentString(aData);

  if (eventName.EqualsLiteral("EVENT_RECOGNITIONSERVICE_ERROR")) {
    mRecognition->DispatchError(
        SpeechRecognition::EVENT_RECOGNITIONSERVICE_ERROR,
        SpeechRecognitionErrorCode::Network,  // TODO different codes?
        NS_LITERAL_STRING("RECOGNITIONSERVICE_ERROR test event"));

  } else if (eventName.EqualsLiteral("EVENT_RECOGNITIONSERVICE_FINAL_RESULT")) {
    RefPtr<SpeechEvent> event = new SpeechEvent(
        mRecognition, SpeechRecognition::EVENT_RECOGNITIONSERVICE_FINAL_RESULT);

    // event->mRecognitionResultList = BuildResultList();
    // NS_DispatchToMainThread(event);
  }

  return NS_OK;
}

SpeechRecognitionResultList*
DSSpeechRecognitionService::BuildResultList(const char* sttResult) {
  DS_LOG("%s", __PRETTY_FUNCTION__);

  SpeechRecognitionResultList* resultList =
      new SpeechRecognitionResultList(mRecognition);
  SpeechRecognitionResult* result = new SpeechRecognitionResult(mRecognition);
  if (0 < mRecognition->MaxAlternatives()) {
    SpeechRecognitionAlternative* alternative =
        new SpeechRecognitionAlternative(mRecognition);

    alternative->mTranscript = NS_ConvertUTF8toUTF16(sttResult);
    alternative->mConfidence = 1.0f;

    result->mItems.AppendElement(alternative);
  }
  resultList->mItems.AppendElement(result);

  return resultList;
}

}  // namespace mozilla
