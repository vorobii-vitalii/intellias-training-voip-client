import React from "react";
import "./App.css";
import { Invitation, Session, SessionState } from "sip.js";
import { Button, Card } from "antd";

export interface IncomingCallProps {
  session: Session;
  onAccept: () => void;
  onReject: () => void;
}

function getName(session: Session) {
  return session.remoteIdentity.displayName || session.remoteIdentity.uri.toString();
}

function IncomingCall(props : IncomingCallProps) {
  // TODO: Check state
  // session.state == SessionState.Established
  return (
    <Card key={props.session.id} title={"Call from " + getName(props.session)}>
      <Button type="primary" onClick={props.onAccept}>Accept</Button>
      <Button type="dashed" onClick={props.onReject}>Reject</Button>
    </Card>
  );
}

export default IncomingCall;