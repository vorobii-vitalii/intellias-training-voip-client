import React, {
  createRef,
  RefObject,
  useEffect,
  useMemo,
  useState
} from "react";
import "./App.css";
import {
  defaultSessionDescriptionHandlerFactory,
  SessionManager,
  SessionManagerOptions
} from "sip.js/lib/platform/web";
import { Button, Divider, Input, Layout, List } from "antd";
import IncomingCall from "./IncomingCall";
import { Header } from "antd/es/layout/layout";
import { IncomingResponse, Levels, URI } from "sip.js/lib/core";
import { Invitation, Inviter, Session, UserAgent } from "sip.js";
import ConferenceView from "./ConferenceView";

const WS_SERVER_URI = "ws://localhost:5068";
const CONFERENCE_FACTORY_URI = "sip:conference-factory@localhost";

export interface MainViewProps {
  sipURI: string;
}

enum CallType {
  CONFERENCE,
  INITIATED,
  RECEIVED
}

interface CallInfo {

}

interface CustomMediaStreamConstraints extends MediaStreamConstraints {
  screenShare: boolean;
}

interface ParticipantVideo {
  refObject: React.RefObject<HTMLVideoElement>;
  mediaStream: MediaStream;
}

function getRedirectContact(response: IncomingResponse): URI {
  return response.message.headers.Contact[0].parsed.uri;
}

export function MainView(props: MainViewProps) {

  const [callEntries, setCallEntries] = useState<JSX.Element[]>([]);
  const [conferences, setConferences] = useState<JSX.Element[]>([]);
  const [localMedia, setLocalMedia] = useState<MediaStream>();
  const [remoteMedia, setRemoteMedia] = useState<MediaStream>();
  const handlerByRemoteURI: Map<string, (session: Session) => void> = new Map<string, (session: Session) => void>();

  const sessionManager = useMemo(() => {
    const sessionManagerOptions: SessionManagerOptions = {
      aor: props.sipURI,
      media: {
        constraints: {
          audio: true,
          video: true
        }
      },
      userAgentOptions: {
        sessionDescriptionHandlerFactory: defaultSessionDescriptionHandlerFactory((c, sessionDescriptionHandler) => {
          if (navigator.mediaDevices === undefined) {
            return Promise.reject(new Error("Media devices not available in insecure contexts."));
          }
          const constraints = c as CustomMediaStreamConstraints;
          // Handle factory URI
          console.log("Session description handling " + JSON.stringify(constraints));
          // Share screen mode
          if (constraints.screenShare) {
            console.log("Get screen capture");
            return navigator.mediaDevices.getDisplayMedia();
          }
          console.log("Normal flow");
          return navigator.mediaDevices.getUserMedia.call(navigator.mediaDevices, constraints);
        }),
        delegate: {
          onInvite(invitation) {
          }
        },
        logLevel: "debug",
        logConnector: (level, category, label, content) => {
          console.log(category + " -->" + " label = " + label + " content = " + content);
        }
      },
      delegate: {
        onRegistered: () => {
          console.log("Client registered");
        },
        onUnregistered: () => {
          console.log("Client unregistered");
        },
        onServerConnect: () => {
          console.log("Connection to server established!");
        },
        onServerDisconnect(error?: Error) {
          console.error("Connection to server lost ", error);
        },
        onCallAnswered: (session) => {
          // session.remoteIdentity.uri
          // session.info();
          const remoteAddressOfRecord = session.remoteIdentity.uri.aor;
          console.log(`Establishing session to ${remoteAddressOfRecord}...`);
          const handler = handlerByRemoteURI.get(remoteAddressOfRecord);
          if (handler) {
            handler(session);
          } else {
            const localMediaStream = sessionManager.getLocalMediaStream(session);
            const remoteMediaStream = sessionManager.getRemoteMediaStream(session);
            console.log("Local media = " + localMediaStream);
            console.log("Remote media = " + remoteMediaStream);
            setLocalMedia(localMediaStream);
            setRemoteMedia(remoteMediaStream);
          }
        },
        onCallReceived: (session) => {
          console.log("Call received");
          const invitation = session as Invitation;
          const incomingCall =
            <IncomingCall
              onAccept={() => {
                console.log(invitation + " accepted");
                invitation.accept({
                  sessionDescriptionHandlerOptions: {
                    constraints: {
                      video: true,
                      audio: true
                    }
                  }
                });
              }}
              onReject={() => {
                console.log(invitation + " rejected");
                invitation.reject();
              }}
              session={invitation}
            ></IncomingCall>;
          setCallEntries([...callEntries, incomingCall]);
        },
        onCallCreated(session) {
          console.log("Call has been created...");
        }
      }
    };
    return new SessionManager(WS_SERVER_URI, sessionManagerOptions);
  }, []);

  useEffect(() => {
    sessionManager.connect().then(v => {
      sessionManager.register({});
    });
  }, [sessionManager]);

  const [callingSipURI, setCallingSipURI] = useState("");
  const [conferenceURI, setConferenceURI] = useState("");
  const localVideoRef = createRef<HTMLVideoElement>();
  const remoteVideoRef = createRef<HTMLVideoElement>();
  let [remoteParticipants, setRemoteParticipants] = useState<Array<ParticipantVideo>>([]);

  useEffect(() => {
    const current = localVideoRef.current;
    if (!current || !localMedia) {
      return;
    }
    console.log("Changing local stream...");
    current.srcObject = localMedia;
  }, [localMedia]);

  useEffect(() => {
    const current = remoteVideoRef.current;
    if (!current || !remoteMedia) {
      return;
    }
    console.log("Changing remote stream...");
    current.srcObject = remoteMedia;

  }, [remoteMedia]);

  useEffect(() => {
    console.log(`Remote participants changed...`);
    remoteParticipants.forEach(v => {
      console.log(`participant ${v.mediaStream} ${v.mediaStream.getTracks()}`)
      if (v.refObject.current) {
        console.log("Attached");
        v.refObject.current.srcObject = v.mediaStream;
      } else {
        console.log("Not attached");
      }
    });
  }, [remoteParticipants]);

  return (
    <Layout>
      <video ref={localVideoRef} autoPlay={true} />
      <video ref={remoteVideoRef} autoPlay={true} />
      {
        remoteParticipants.map((v, i) => {
          return <video ref={v.refObject}
                        id={"video " + v.mediaStream.getVideoTracks()[0].id}
                        key={"video " + v.mediaStream.getVideoTracks()[0].id}
                        autoPlay={true}
          />;
        })
      }
      <Header
        style={{
          color: "white"
        }}
      >VOIP client</Header>
      <List
        header="Sessions"
        bordered
        dataSource={callEntries}
        renderItem={e => e}
      />
      <Divider />
      <Input placeholder="Whom to call?" value={callingSipURI}
             onChange={e => setCallingSipURI(e.target.value)} />
      <Button
        type="primary"
        onClick={e => {
          console.log(`Calling ${callingSipURI}`);
          sessionManager.call(callingSipURI, {}, {
            requestDelegate: {
              onAccept(response) {
                console.log(`Accepted call ${callingSipURI}`);
              },
              onTrying(response: IncomingResponse) {
              }
            },
            sessionDescriptionHandlerOptions: {
              constraints: {
                audio: true,
                video: true
              }
            }
          });
        }}
      >Submit</Button>
      <Divider />
      <List
        header="Conferences"
        bordered
        dataSource={conferences}
        renderItem={e => e}
      />
      <Divider />
      <Button
        type="primary"
        onClick={e => {
          console.log("Creating conference");
          sessionManager.call(CONFERENCE_FACTORY_URI, {}, {
            requestDelegate: {
              onRedirect(response) {
                const conferenceURI = getRedirectContact(response);
                console.log(`Received redirection to ${conferenceURI}`);
                const newConference =
                  <ConferenceView
                    conferenceAddressOfRecord={conferenceURI.aor}
                    conferenceId={conferenceURI.user as string}
                    sessionManager={sessionManager}
                    updateHandler={sessionHandler => {
                      handlerByRemoteURI.set(conferenceURI.aor, sessionHandler);
                    }}
                    currentSipURI={props.sipURI}
                    onStreamReceive={stream => {
                      console.log(`New stream received ${stream} prev participants length = ${remoteParticipants.length} `);
                      const videoElementRef = createRef<HTMLVideoElement>();
                      remoteParticipants = [...remoteParticipants, {
                        refObject: videoElementRef,
                        mediaStream: stream
                      }]
                      setRemoteParticipants(remoteParticipants);
                    }}
                  />;
                setConferences([...conferences, newConference]);
              }
            }
          }).then(s => {
          });
        }}
      >Create conference</Button>
      <Input placeholder="Enter conference URI" value={conferenceURI}
             onChange={e => setConferenceURI(e.target.value)} />
      <Button
        type="primary"
        onClick={e => {
          console.log(`Adding new conference ${conferenceURI}`);
          const uri = (UserAgent.makeURI(conferenceURI) as URI) as URI;
          const newConference =
            <ConferenceView
              conferenceAddressOfRecord={uri.aor}
              conferenceId={uri.user as string}
              sessionManager={sessionManager}
              currentSipURI={props.sipURI}
              updateHandler={sessionHandler => {
                handlerByRemoteURI.set(uri.aor, sessionHandler);
              }}
              onStreamReceive={stream => {
                console.log(`New stream received ${stream} prev participants length = ${remoteParticipants.length} `);
                const videoElementRef = createRef<HTMLVideoElement>();
                remoteParticipants = [...remoteParticipants, {
                  refObject: videoElementRef,
                  mediaStream: stream
                }]
                setRemoteParticipants(remoteParticipants);
              }}

            />;
          setConferences([...conferences, newConference]);
        }}
      >Submit</Button>
      <Divider />
    </Layout>
  );
}
