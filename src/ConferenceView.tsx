import React, { createRef, useState } from "react";
import "./App.css";
import {
  Info,
  Inviter,
  Session,
  SessionDescriptionHandler,
  Subscriber,
  UserAgent
} from "sip.js";
import { Player } from 'video-react';
import { Button, Card, Typography } from "antd";
import { URI } from "sip.js/lib/core";
import { SessionManager } from "sip.js/lib/platform/web";
import { TSMap } from "typescript-map";

export interface ConferenceViewProps {
  conferenceAddressOfRecord: string;
  conferenceId: string;
  sessionManager: SessionManager;
  currentSipURI: string;
  onStreamReceive: (mediaStream: MediaStream) => void;
  updateHandler: (handler: (session: Session) => void) => void;
}

interface Participant {
  participantKey: string;
  sdpOffer: string;
}

interface ParticipantVideo {
  refObject: React.RefObject<HTMLVideoElement>;
  mediaStream: MediaStream;
  name: string;
}

const SIP_URI_PREFIX = "sip:";

function ConferenceView(props: ConferenceViewProps) {
  const participantsMap: Map<String, boolean> = new Map<String, boolean>();
  const [isJoined, setJoined] = useState(false);
  let [videoParticipants, setVideoParticipants] = useState<Array<ParticipantVideo>>([]);

  const toRequestURI = (uri: string) => {
    return SIP_URI_PREFIX + uri;
  };

  const onParticipantsUpdate = async (participants: Array<Participant>) => {
    const sdpAnswerByParticipant = new TSMap<string, string>();
    for (const participant of participants) {
      if (participant.participantKey === props.currentSipURI) {
        console.log("Skipping current SIP URI...");
        continue;
      }
      if (participantsMap.has(participant.participantKey)) {
        continue;
      }
      console.log(`Connecting to ${participant.participantKey}`);
      participantsMap.set(participant.participantKey, true);

      const rtcPeerConnection = new RTCPeerConnection({
        iceServers: [
          {
            urls: "stun:stun.l.google.com:19302"
          },
          {
            urls: "stun:stun1.l.google.com:19302"
          }
        ]
      });
      rtcPeerConnection.oniceconnectionstatechange = e => {
        console.log(`ice connection state change ${e}`);
      };
      rtcPeerConnection.onicecandidateerror = e => {
        console.log(`ice error ${e}`);
      };
      rtcPeerConnection.onnegotiationneeded = e => {
        console.log("Negotiation is needed!");
      };
      await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: participant.sdpOffer
      }));
      rtcPeerConnection.onconnectionstatechange = e => {
        console.log(`Connection state changed ${e}`);
      };
      console.log("Creating answer...");
      const descriptionInit = await rtcPeerConnection.createAnswer({
        mediaConstraints: {
          audio: true,
          video: true
        }
      });
      await rtcPeerConnection.setLocalDescription(descriptionInit);
      await new Promise((resolve) => {
        console.log("Initial ice gathering state = " + rtcPeerConnection.iceGatheringState);
        if (rtcPeerConnection.iceGatheringState === 'complete') {
          resolve(null);
        } else {
          rtcPeerConnection.onicegatheringstatechange = () => {
            console.log(`ice gathering state change ${rtcPeerConnection.iceGatheringState}`);
            if (rtcPeerConnection.iceGatheringState === 'complete') {
              resolve(null);
            }
          };
        }
      });
      const updatedDescription = rtcPeerConnection.localDescription;
      console.log(`SDP answer = for ${participant.participantKey} before = ${descriptionInit.sdp} after = ${updatedDescription}`);
      if (updatedDescription != null) {
        sdpAnswerByParticipant.set(participant.participantKey, updatedDescription.sdp);
      }
      const remoteMediaStream = new MediaStream();
      rtcPeerConnection.getReceivers().forEach(receiver => {
        remoteMediaStream.addTrack(receiver.track);
      });
      // props.onStreamReceive(remoteMediaStream);
      const videoElementRef = createRef<HTMLVideoElement>();
      videoParticipants = [...videoParticipants, {
        refObject: videoElementRef,
        mediaStream: remoteMediaStream,
        name: participant.participantKey
      }];
      setVideoParticipants(videoParticipants);
    }
    return sdpAnswerByParticipant;
  };

  function createSubscriberOnConferenceEvents() {
    const conferenceURI = UserAgent.makeURI(toRequestURI(props.conferenceAddressOfRecord)) as URI;
    return new Subscriber(props.sessionManager.userAgent, conferenceURI, "conference");
  }

  const onScreenShare = () => {
    props.updateHandler((session: Session) => {
      console.log("Handling session for screen sharing...");
      const localMediaStream = props.sessionManager.getLocalMediaStream(session);
      const remoteMediaStream = props.sessionManager.getRemoteMediaStream(session);
    });
    let peerConnection: RTCPeerConnection | null = null;
    props.sessionManager.call(toRequestURI(props.conferenceAddressOfRecord), {
      extraHeaders: [
        "X-Disambiguator: screen-sharing",
        "X-Receiving: false"
      ],
      delegate: {
        onSessionDescriptionHandler(sessionDescriptionHandler: SessionDescriptionHandler, provisional: boolean) {
          console.log("Session description handler (screen sharing)");
          let obj: any = sessionDescriptionHandler;
          peerConnection = obj.peerConnection as RTCPeerConnection;
        }
      }
    }, {
      requestOptions: {
        extraHeaders: [
          "X-Disambiguator: screen-sharing",
          "X-Receiving: false"
        ]
      },
      requestDelegate: {
        onAccept(response) {
          console.log("Screen share accepted...");
        }
      },
      sessionDescriptionHandlerOptions: {
        constraints: {
          audio: false,
          video: false,
          screenShare: true
        },
      },
    }).then(inviter => {
      if (inviter.delegate) {
        inviter.delegate.onInfo = (info: Info) => {
          console.log(`Adding new ICE candidate... for screen sharing ${info.request.body}`);
          peerConnection?.addIceCandidate({
            candidate: info.request.body
          });
          info.accept();
        };
      }
    });
  };

  let [subscriber, setSubscriber] = useState<Subscriber | null>(null);
  let [inviterMain, setInviterMain] = useState<Inviter | null>(null);
  let [inviterScreenShare, setInviterScreenShare] = useState<Inviter | null>(null);


  function SrcObjectVideo({ srcObject } : {srcObject: MediaStream}){
    const ref = createRef<HTMLVideoElement>();
    React.useEffect(() => {
       if (ref.current) {
         ref.current.srcObject = srcObject;
       }
    }, [srcObject]);
    return <video ref={ref} autoPlay={true} />
  }

  const onConferenceJoin = () => {
    // Send invite to conference URI
    let peerConnection: RTCPeerConnection | null = null;
    props.sessionManager.call(toRequestURI(props.conferenceAddressOfRecord), {
      delegate: {
        onInfo(info) {
          console.log(`Adding new ICE candidate... ${info.request.body}`);
          peerConnection?.addIceCandidate({
            candidate: info.request.body
          });
        },
        onSessionDescriptionHandler(sessionDescriptionHandler: SessionDescriptionHandler, provisional: boolean) {
          let obj: any = sessionDescriptionHandler;
          peerConnection = obj.peerConnection as RTCPeerConnection;
          console.log(`Peer connection = ${peerConnection}`);

        }
      }
    }, {
      requestDelegate: {
        onAccept(response) {
          console.log(`Successfully joined conference ${toRequestURI(props.conferenceAddressOfRecord)}`);
          const createdSubscriber = createSubscriberOnConferenceEvents();
          createdSubscriber.delegate = {
            onNotify: (notification) => {
              const participants = JSON.parse(notification.request.body) as Array<Participant>;
              console.log(`Participants list = ${participants}`);
              onParticipantsUpdate(participants)
                .then(v => {
                  console.log(`SDP response by SIP = ${v.toJSON()}`);
                  notification.accept({
                    body: {
                      content: JSON.stringify({
                        sdpAnswerBySipURI: v.toJSON()
                      }),
                      contentType: "application/json",
                      contentDisposition: "session"
                    },
                    statusCode: 200
                  });
                });
            }
          };
          createdSubscriber.subscribe();
          setSubscriber(createdSubscriber);
          setJoined(true);
        }
      },
      sessionDescriptionHandlerOptions: {
        constraints: {
          audio: true,
          video: true
        }
      }
    }).then(inviter => {
      setInviterMain(inviter);
      if (inviter.delegate) {
        inviter.delegate.onInfo = (info: Info) => {
          console.log(`Adding new ICE candidate... ${info.request.body}`);
          peerConnection?.addIceCandidate({
            candidate: info.request.body
          });
          info.accept();
        };
      }
    });
  };

  const leaveConference = () => {
    subscriber && subscriber.unsubscribe();
    inviterMain && inviterMain.bye();
  };

  if (!isJoined) {
    return (
      <Card key={props.conferenceAddressOfRecord.toString()}
            title={`Conference ${props.conferenceAddressOfRecord}`}>
        <Button type="primary" onClick={e => onConferenceJoin()}>Join
          conference</Button>
      </Card>
    );
  }
  return (
    <Card key={props.conferenceAddressOfRecord.toString()}
          title={`Conference ${props.conferenceAddressOfRecord}`}>
      <Typography.Text>Participants</Typography.Text>
      {
        videoParticipants.map((v, i) => {
          return (
            // <Player>
            //   <source src={URL.createObjectURL(v.mediaStream as unknown as Blob)} />
            // </Player>
            <Card title={v.name} key={v.name}>
              <SrcObjectVideo srcObject={v.mediaStream} key={v.name} />
            </Card>
          );
        })
      }
      <Button type="primary" onClick={e => {
        onScreenShare();
      }}>Start sharing</Button>
      <Button type="dashed" onClick={e => {
        leaveConference();
      }}>Leave</Button>
    </Card>
  );

}

export default ConferenceView;