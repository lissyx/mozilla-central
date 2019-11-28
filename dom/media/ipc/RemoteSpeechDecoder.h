/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#ifndef include_dom_media_ipc_RemoteSpeechDecoderChild_h
#define include_dom_media_ipc_RemoteSpeechDecoderChild_h
#include "RemoteDecoderChild.h"
#include "RemoteDecoderParent.h"

namespace mozilla {
namespace layers {
class BufferRecycleBin;
}  // namespace layers
}  // namespace mozilla

namespace mozilla {

using mozilla::ipc::IPCResult;

class RemoteSpeechDecoderChild final : public RemoteDecoderChild {
 public:
  explicit RemoteSpeechDecoderChild(bool aRecreatedOnCrash);

  RemoteSpeechDecoderChild();

  MOZ_IS_CLASS_INIT
  MediaResult InitIPDL();

  MediaResult ProcessOutput(const DecodedOutputIPDL& aDecodedData) override;
};

class RemoteSpeechDecoderParent final : public RemoteDecoderParent {
 public:
  RemoteSpeechDecoderParent(RemoteDecoderManagerParent* aParent, TaskQueue* aManagerTaskQueue,
    TaskQueue* aDecodeTaskQueue, nsCString* aErrorDescription);

 protected:
  MediaResult ProcessDecodedData(const MediaDataDecoder::DecodedData& aData,
                                 DecodedOutputIPDL& aDecodedData) override;
};

}  // namespace mozilla

#endif  // include_dom_media_ipc_RemoteSpeechDecoderChild_h
