import React from 'react';
import './App.css';
import Amplify from 'aws-amplify';
import { withAuthenticator, AmplifySignOut } from '@aws-amplify/ui-react';
import awsconfig from './aws-exports';
import {Dashboard} from './features/dashboard/Dashboard';

Amplify.configure(awsconfig);

const App = () => (
    <>
      <AmplifySignOut />
      <Dashboard />
    </>
);

export default withAuthenticator(App);
