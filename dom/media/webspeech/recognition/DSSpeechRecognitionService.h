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

#include <speex/speex_resampler.h>
#include <dlfcn.h>

#define NS_DS_SPEECH_RECOGNITION_SERVICE_CID   \
  {0x586f87aa,                                 \
   0x64e8,                                     \
   0x465d,                                     \
   {0x83, 0x1b, 0x9f, 0xca, 0x2a, 0x68, 0xfb, 0x0c}};

#define DS_SYM(varname)                                                   \
    *(void**)(&varname) = dlsym(libdeepspeech_so, #varname"");            \
    if (!varname) {                                                       \
        char* dl_error;                                                   \
        dl_error = dlerror();                                             \
        DS_LOG("%s error at dlsym(): %s", __PRETTY_FUNCTION__, dl_error); \
        return;                                                           \
    }

#define DS_UNSYM(varname)  \
    if (varname) {         \
        varname = nullptr; \
    }

struct ModelState;
struct StreamingState;

struct MetadataItem {
  char* character;
  int timestep;
  float start_time;
};

struct Metadata {
  MetadataItem* items;
  int num_items;
  double probability;
};

enum DeepSpeech_Error_Codes
{
    // OK
    DS_ERR_OK                 = 0x0000,

    // Missing invormations
    DS_ERR_NO_MODEL           = 0x1000,

    // Invalid parameters
    DS_ERR_INVALID_ALPHABET   = 0x2000,
    DS_ERR_INVALID_SHAPE      = 0x2001,
    DS_ERR_INVALID_LM         = 0x2002,
    DS_ERR_MODEL_INCOMPATIBLE = 0x2003,

    // Runtime failures
    DS_ERR_FAIL_INIT_MMAP     = 0x3000,
    DS_ERR_FAIL_INIT_SESS     = 0x3001,
    DS_ERR_FAIL_INTERPRETER   = 0x3002,
    DS_ERR_FAIL_RUN_SESS      = 0x3003,
    DS_ERR_FAIL_CREATE_STREAM = 0x3004,
    DS_ERR_FAIL_READ_PROTOBUF = 0x3005,
    DS_ERR_FAIL_CREATE_SESS   = 0x3006,
};

namespace mozilla {

class DSSpeechRecognitionService : public nsISpeechRecognitionService,
                                     public nsIObserver {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSISPEECHRECOGNITIONSERVICE
  NS_DECL_NSIOBSERVER

  DSSpeechRecognitionService();

 private:
  virtual ~DSSpeechRecognitionService();

  ModelState* dsModel = nullptr;
  StreamingState* streamState = nullptr;

  FILE* debugWAV;

  /** libdeepspeech bindings **/
  void* libdeepspeech_so = nullptr;

  int (*DS_CreateModel)(const char*, unsigned int, unsigned int, const char*, unsigned int, ModelState**) = nullptr;
  int (*DS_EnableDecoderWithLM)(ModelState*,const char*, const char*, const char*, float, float) = nullptr;
  void (*DS_DestroyModel)(ModelState*) = nullptr;

  int (*DS_SetupStream)(ModelState*, unsigned int, unsigned int, StreamingState**) = nullptr;
  void (*DS_FeedAudioContent)(StreamingState*, const short*, unsigned int) = nullptr;
  char* (*DS_IntermediateDecode)(StreamingState*) = nullptr;
  char* (*DS_FinishStream)(StreamingState*) = nullptr;
  void (*DS_DiscardStream)(StreamingState*) = nullptr;

  void (*DS_FreeString)(char*) = nullptr;

  void (*DS_PrintVersions)(void) = nullptr;
  /** end of libdeespeech **/

  SpeexResamplerState* mResampler = nullptr;
  WeakPtr<dom::SpeechRecognition> mRecognition;
  dom::SpeechRecognitionResultList* BuildResultList(const char* str);
};

}  // namespace mozilla

#endif
