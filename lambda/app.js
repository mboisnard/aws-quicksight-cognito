const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwtDecode = require('jwt-decode');

const { getCurrentInvoke } = require('@vendia/serverless-express');

const AWS = require("aws-sdk");
const cognitoIdentity = new AWS.CognitoIdentity();
const stsClient = new AWS.STS();

const app = express();
const router = express.Router();

router.use(cors());
router.use(bodyParser.json());

router.get('/url', async (req, res) => {

    const { event } = getCurrentInvoke();

    const extractedIdToken = event.headers.Authorization;
    const decodedIdToken = jwtDecode(extractedIdToken);

    const cognitoInfos = {
        idToken: extractedIdToken,
        identityPoolId: process.env.COGNITO_IDENTITY_POOL_ID,
        userPoolUrl: process.env.COGNITO_USER_POOL_URL
    };

    const stsInfos = {
        roleToAssumeArn: process.env.STS_ROLE_ARN_TO_ASSUME,
        sessionName: decodedIdToken.sub
    };

    const quickSightInfos = {
        region: process.env.QUICKSIGHT_REGION,
        dashboard: {
            id: process.env.QUICKSIGHT_DASHBOARD_ID,
            disableReset: false,
            disableUndoRedo: false,
            sessionLifetime: 600
        },
        accountId: process.env.AWS_ACCOUNT_ID,
        user: {
            email: decodedIdToken.email,
            sessionName: decodedIdToken.sub,
            roleArn: stsInfos.roleToAssumeArn
        }
    };

    const credentials = await getConnectedCognitoUserTemporaryIAMCredentials(cognitoInfos, stsInfos);

    const quicksightApi = new AWS.QuickSight({
        region: quickSightInfos.region,
        credentials: {
            accessKeyId: credentials.Credentials.AccessKeyId,
            secretAccessKey: credentials.Credentials.SecretAccessKey,
            sessionToken: credentials.Credentials.SessionToken,
            expiration: credentials.Credentials.Expiration
        }
    });

    let quicksightUrl;

    try {
        await createQuicksightUserIfNotExists(quicksightApi, quickSightInfos);
        quicksightUrl = await getQuicksightEmbeddedUrl(quicksightApi, quickSightInfos);
    } catch (err) {
        if (err.code && err.code === 'ResourceExistsException') {
            quicksightUrl = await getQuicksightEmbeddedUrl(quicksightApi, quickSightInfos);
        } else {
            res.json({err});
        }
    }

    res.json({ url: quicksightUrl.EmbedUrl });
});

async function getCognitoOpenIdToken(cognitoInfos) {

    const params = {
        IdentityPoolId: cognitoInfos.identityPoolId,
        Logins: {
            [cognitoInfos.userPoolUrl] : cognitoInfos.idToken
        }
    };

    const cognitoId = await cognitoIdentity.getId(params).promise();

    cognitoId.Logins = {
        [cognitoInfos.userPoolUrl] : cognitoInfos.idToken
    };

    return cognitoIdentity.getOpenIdToken(cognitoId).promise();
}

async function getConnectedCognitoUserTemporaryIAMCredentials(cognitoInfos, stsInfos) {

    const openIdToken = await getCognitoOpenIdToken(cognitoInfos);

    const stsParams = {
        RoleSessionName: stsInfos.sessionName,
        WebIdentityToken: openIdToken.Token,
        RoleArn: stsInfos.roleToAssumeArn
    };
    
    return stsClient.assumeRoleWithWebIdentity(stsParams).promise();
}

async function createQuicksightUserIfNotExists(quicksightApi, quickSightInfos) {

    const userToRegisterParams = {
        AwsAccountId: quickSightInfos.accountId,
        Email: quickSightInfos.user.email,
        IdentityType: 'IAM',
        Namespace: 'default',
        UserRole: 'READER',
        IamArn: quickSightInfos.user.roleArn,
        SessionName: quickSightInfos.user.sessionName
    };

    return quicksightApi.registerUser(userToRegisterParams).promise();
}

async function getQuicksightEmbeddedUrl(quicksightApi, quickSightInfos) {

    const dashboardParams = {
        AwsAccountId: quickSightInfos.accountId,
        DashboardId: quickSightInfos.dashboard.id,
        IdentityType: 'IAM',
        ResetDisabled: quickSightInfos.dashboard.disableReset,
        SessionLifetimeInMinutes: quickSightInfos.dashboard.sessionLifetime,
        UndoRedoDisabled: quickSightInfos.dashboard.disableUndoRedo
    };

    return quicksightApi.getDashboardEmbedUrl(dashboardParams).promise();
}

app.use('/', router);

module.exports = app;