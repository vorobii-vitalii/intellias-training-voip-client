import React, {
  createRef,
  RefObject,
  useEffect,
  useMemo,
  useState
} from "react";
import "./App.css";
import { SessionManager, SessionManagerOptions } from "sip.js/lib/platform/web";
import { Button, Divider, Input, Layout, List } from "antd";
import IncomingCall from "./IncomingCall";
import { Header } from "antd/es/layout/layout";
import { IncomingResponse, Levels, URI } from "sip.js/lib/core";
import { Invitation, UserAgent } from "sip.js";
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

function getRedirectContact(response: IncomingResponse) : URI {
  return response.message.headers.Contact[0].parsed.uri;
}

export function MainView(props : MainViewProps) {

  const [callEntries, setCallEntries] = useState<JSX.Element[]>([]);
  const [conferences, setConferences] = useState<JSX.Element[]>([]);
  const [localMedia, setLocalMedia] = useState<MediaStream>();
  const [remoteMedia, setRemoteMedia] = useState<MediaStream>();


  const sessionManager = useMemo(() => {
    const sessionManagerOptions : SessionManagerOptions = {
      aor: props.sipURI,
      media: {
        constraints: {
          audio: true,
          video: true
        }
      },
      userAgentOptions: {
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
          var dialog = session.dialog;
          dialog?.info()
          // session.remoteIdentity.uri
          // session.info();
          console.log("Call was answered (root)");
          const localMediaStream = sessionManager.getLocalMediaStream(session);
          const remoteMediaStream = sessionManager.getRemoteMediaStream(session);
          console.log("Local media = " + localMediaStream);
          console.log("Remote media = " + remoteMediaStream);
          setLocalMedia(localMediaStream);
          setRemoteMedia(remoteMediaStream);
        },
        onCallReceived: (session) => {
// const uri : URI = UserAgent.makeURI(CONFERENCE_FACTORY_URI) as URI;
          // session.refer(uri, {
          //   requestDelegate: {
          //
          //   }
          // })
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
                })
              }}
              onReject={() => {
                console.log(invitation + " rejected");
                invitation.reject();
              }}
              session={invitation}
            ></IncomingCall>;
          setCallEntries([...callEntries, incomingCall])
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
  const [remoteParticipants, setRemoteParticipants] = useState<Array<JSX.Element>>([]);

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

  return (
    <Layout>
      <video ref={localVideoRef} autoPlay={true} />
      <video ref={remoteVideoRef} autoPlay={true} />
      {
        remoteParticipants.map(v => {
          return <div> {v} </div>;
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
                    currentSipURI={props.sipURI}
                    onStreamReceive={stream => {
                      setRemoteMedia(stream);
                      // const videoElement = createRef<HTMLVideoElement>();
                      // const video = <video ref={videoElement}
                      //                      autoPlay={true} />;
                      // const current = videoElement.current;
                      // if (current == null) {
                      //   console.log("Video not created");
                      //   return;
                      // }
                      // console.log("Creating video");
                      // current.srcObject = stream;
                      // setRemoteParticipants([...remoteParticipants, video]);
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
              onStreamReceive={stream => {
                setRemoteMedia(stream);
                // const videoElement = createRef<HTMLVideoElement>();
                // const video = <video ref={videoElement}
                //                      autoPlay={true} />;
                // const current = videoElement.current;
                // if (current == null) {
                //   return;
                // }
                // current.srcObject = stream;
                // setRemoteParticipants([...remoteParticipants, video]);
              }}

            />;
          setConferences([...conferences, newConference]);
        }}
      >Submit</Button>
      <Divider />
    </Layout>
  );
}
