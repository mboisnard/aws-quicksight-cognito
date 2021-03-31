import {API, Auth } from 'aws-amplify';
import React, {useEffect} from 'react';

import styles from './Dashboard.module.css';

const QuicksightEmbedding = require('amazon-quicksight-embedding-sdk');

export const Dashboard = () => {

    useEffect(() => {
        async function loadSession() {
            const session = await Auth.currentSession();
            const embeddedDashboardUrl = await API.get(
              "lambdaApi", "/quicksight-cognito/url",
            {
                    headers: {
                        Authorization: session.getIdToken().getJwtToken()
                    }
                }
            );

            const quicksightOptions = {
                url: embeddedDashboardUrl.url,
                container: document.getElementById('quicksight'),
                height: '100%',
                scrolling: 'no',
                sheetTabsDisabled: false
            };

            QuicksightEmbedding.embedDashboard(quicksightOptions);
        }

        loadSession();
    }, []);

    return (
        <div className={styles.root} id="quicksight" />
    );
};
