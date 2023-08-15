import React, { useEffect, useState } from "react";
import "./App.css";
import {Inviter, Session, SessionDescriptionHandler, Subscriber, UserAgent} from "sip.js";
import { Button, Card, Typography } from "antd";
import { URI } from "sip.js/lib/core";
import { SessionManager } from "sip.js/lib/platform/web";
import { TSMap } from "typescript-map";

export interface ConferenceViewProps {
  conferenceAddressOfRecord: string;
  conferenceId: string;
  sessionManager: SessionManager;
  currentSipURI : string;
  onStreamReceive: (mediaStream : MediaStream) => void;
  updateHandler: (handler : (session: Session) => void) => void
}

interface Participant {
  participantKey: string;
  sdpOffer: string;
}

const SIP_URI_PREFIX = "sip:";

function ConferenceView(props : ConferenceViewProps) {
  const participantsMap: Map<String, boolean> = new Map<String, boolean>();
  const [isJoined, setJoined] = useState(false);

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
      rtcPeerConnection.ontrack = event => {
        const track = event.track;
        console.log(`On track ${track.kind}`);
        props.onStreamReceive(event.streams[0]);
      };
      rtcPeerConnection.onnegotiationneeded = e => {
        console.log("Negotiation is needed!");
      };
      await rtcPeerConnection.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: participant.sdpOffer
      }))
      rtcPeerConnection.onconnectionstatechange = e => {
        console.log(`Connection state changed ${e}`)
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
    }
    return sdpAnswerByParticipant;
  };

  function createSubscriberOnConferenceEvents() {
    const conferenceURI = UserAgent.makeURI(toRequestURI(props.conferenceAddressOfRecord)) as URI;
    return new Subscriber(props.sessionManager.userAgent, conferenceURI, "conference");
  }

  const onScreenShare = () => {
    props.updateHandler((session : Session) => {
      console.log("Handling session for screen sharing...");
    });
    let sessionDescriptionHandler : SessionDescriptionHandler;
    props.sessionManager.call(toRequestURI(props.conferenceAddressOfRecord), {
      delegate: {
        onSessionDescriptionHandler(handler, provisional) {
          sessionDescriptionHandler = handler;
        }
      },
      extraHeaders: [
        "X-Disambiguator: screen-sharing",
        "X-Receiving: false"
      ]
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
          audio: true,
          video: true
        },
      },
      sessionDescriptionHandlerModifiers: [
          init => {
            if (init.type !== "offer") {
              return Promise.resolve(init);
            }
            console.log("initial sdp = " + init.sdp);
            const any : any = sessionDescriptionHandler;
            const peerConnection: RTCPeerConnection = any._peerConnection as RTCPeerConnection;
            console.log("Setup session description for screen sharing");
            return navigator.mediaDevices.getDisplayMedia({video: true})
                .then(streams => {
                  const videoTrack = streams.getVideoTracks()[0];
                  peerConnection.getSenders().forEach(function (s) {
                    peerConnection.removeTrack(s);
                  });
                  peerConnection.addTrack(videoTrack);
                  return peerConnection.createOffer({
                    offerToReceiveAudio: false,
                    offerToReceiveVideo: false
                  });
                }, function (error) {
                  console.log("error ", error);
                  throw error;
                })
                .then(v => {
                  console.log("after sdp = " + v.sdp);
                  return v
                })
          }
      ]
    })
  };

  const onConferenceJoin = () => {
    // Send invite to conference URI
    props.sessionManager.call(toRequestURI(props.conferenceAddressOfRecord), {}, {
      requestDelegate: {
        onAccept(response) {
          console.log(`Successfully joined conference ${toRequestURI(props.conferenceAddressOfRecord)}`);
          const subscriber = createSubscriberOnConferenceEvents();
          subscriber.delegate = {
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
                })
            }
          };
          subscriber.subscribe();
          setJoined(true);
        }
      },
      sessionDescriptionHandlerOptions: {
        constraints: {
          audio: true,
          video: true
        }
      }
    });
  };

  if (!isJoined) {
    return (
      <Card key={props.conferenceAddressOfRecord.toString()} title={`Conference ${props.conferenceAddressOfRecord}`}>
        <Button type="primary" onClick={e => onConferenceJoin()}>Join conference</Button>
      </Card>
    );
  }
  return (
    <Card key={props.conferenceAddressOfRecord.toString()} title={`Conference ${props.conferenceAddressOfRecord}`}>
      <Typography.Text>Joined...</Typography.Text>
      <Button type="primary" onClick={e => {
        onScreenShare();
      }}>Start sharing</Button>
    </Card>
  );

}

export default ConferenceView;