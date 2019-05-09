/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim:set ts=2 sw=2 sts=2 et cindent: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_dom_DSSpeechRecognitionService_h
#define mozilla_dom_DSSpeechRecognitionService_h

#include "nsCOMPtr.h"
#include "nsIObserver.h"
#include "nsISpeechRecognitionService.h"
#include "nsProxyRelease.h"
#include "nsThreadUtils.h"
#include "nsTextFormatter.h"
#include "PDMFactory.h"

#include "mozilla/Monitor.h"
#include "mozilla/SharedThreadPool.h"
#include "mozilla/SharedLibrary.h"
#include "mozilla/Span.h"
#include "mozilla/SPSCQueue.h"

#include <speex/speex_resampler.h>

#include "WavDumper.h"

#define NS_DS_SPEECH_RECOGNITION_SERVICE_CID   \
  {0x586f87aa,                                 \
   0x64e8,                                     \
   0x465d,                                     \
   {0x83, 0x1b, 0x9f, 0xca, 0x2a, 0x68, 0xfb, 0x0c}};

#define DS_SYM(varname)                                                               \
    DS_LOG("%s binding symbol %s", __PRETTY_FUNCTION__, #varname"");                  \
    *(void**)(&varname) = (void*)PR_FindFunctionSymbol(libdeepspeech_so, #varname""); \
    if (!varname) {                                                                   \
        DS_LOG("%s error PR_FindFunctionSymbol()", __PRETTY_FUNCTION__);              \
        PR_UnloadLibrary(libdeepspeech_so);                                           \
        return NS_ERROR_NOT_AVAILABLE;                                                \
    }

#define DS_UNSYM(varname)                                              \
    DS_LOG("%s unbinding symbol %s", __PRETTY_FUNCTION__, #varname""); \
    if (varname) {                                                     \
        varname = nullptr;                                             \
    }

#ifndef DEEPSPEECH_API
#define DEEPSPEECH_API
#include "mozilla/deepspeech.h"
#endif // DEEPSPEECH_API

namespace mozilla {

class DSSpeechRecognitionService : public nsISpeechRecognitionService,
                                   public nsIObserver {
 public:
  NS_DECL_THREADSAFE_ISUPPORTS
  NS_DECL_NSISPEECHRECOGNITIONSERVICE
  NS_DECL_NSIOBSERVER

  DSSpeechRecognitionService();

  void SetLang(const nsAString& aLang);

  void SetContinous(const bool aContinuous) { mContinuous = aContinuous; }

  void SetInterimResults(const bool aInterimResults) { mInterimResults = aInterimResults; }

 private:
  virtual ~DSSpeechRecognitionService();
  void ReleaseThreads();

  nsAutoCString mDebugDir;
  WavDumper* mDebugWAV = nullptr;

  SpeexResamplerState* mResampler = nullptr;
  nsMainThreadPtrHandle<dom::SpeechRecognition> mRecognition;

  void SendEvent(nsString str, float confidence);
  dom::SpeechRecognitionResultList* BuildResultList(nsString str, float confidence);

  RefPtr<TaskQueue> mTaskQueue;
  RefPtr<MediaDataDecoder> mDecoder;
  RefPtr<PDMFactory> mPlatform;

  nsString mLang;
  bool mContinuous;
  bool mInterimResults;
};

}  // namespace mozilla

#endif
