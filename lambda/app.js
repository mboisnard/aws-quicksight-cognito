const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwtDecode = require('jwt-decode');

const { getCurrentInvoke } = require('@vendia/serverless-express');
const { QuickSightClient, RegisterUserCommand, GetDashboardEmbedUrlCommand } = require('@aws-sdk/client-quicksight');
const { CognitoIdentityClient, GetIdCommand, GetOpenIdTokenCommand } = require('@aws-sdk/client-cognito-identity');
const { STSClient, AssumeRoleWithWebIdentityCommand } = require('@aws-sdk/client-sts');

const cognitoIdentity = new CognitoIdentityClient({ region: process.env.QUICKSIGHT_REGION });
const stsClient = new STSClient({ region: process.env.QUICKSIGHT_REGION });

const app = express();
const router = express.Router();

router.use(cors());
router.use(bodyParser.json());

const handleErrorAsync = func => (req, res, next) => {
    func(req, res, next)
        .catch((error) => next(error));
};

router.get('/quicksight-cognito/url', handleErrorAsync(async (req, res, next) => {

    const { event } = getCurrentInvoke();

    const extractedIdToken = event.headers.authorization;
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
        namespace: 'default',
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
            roleName: 'READER',
            iamRoleArn: stsInfos.roleToAssumeArn
        }
    };

    const credentials = await getConnectedCognitoUserTemporaryIAMCredentials(cognitoInfos, stsInfos);

    const quicksightApi = new QuickSightClient({
        region: quickSightInfos.region,
        credentials: {
            accessKeyId: credentials.Credentials.AccessKeyId,
            secretAccessKey: credentials.Credentials.SecretAccessKey,
            sessionToken: credentials.Credentials.SessionToken,
            expiration: credentials.Credentials.Expiration
        }
    });

    try {
        await createQuicksightUserIfNotExists(quicksightApi, quickSightInfos);
    } catch (err) {
        if (!err.code || err.code !== 'ResourceExistsException') {
            next(err);
        }
    }
    
    const quicksightUrl = await getQuicksightEmbeddedUrl(quicksightApi, quickSightInfos);

    res.status(200).json({ 
        url: quicksightUrl.EmbedUrl
    });
}));

async function getCognitoOpenIdToken(cognitoInfos) {

    const getIdCommand = new GetIdCommand({
        IdentityPoolId: cognitoInfos.identityPoolId,
        Logins: {
            [cognitoInfos.userPoolUrl] : cognitoInfos.idToken
        }
    });

    const { IdentityId } = await cognitoIdentity.send(getIdCommand);

    const getOpenIdTokenCommand = new GetOpenIdTokenCommand({
        IdentityId: IdentityId,
        Logins: {
            [cognitoInfos.userPoolUrl] : cognitoInfos.idToken
        }
    });

    return cognitoIdentity.send(getOpenIdTokenCommand);
}

async function getConnectedCognitoUserTemporaryIAMCredentials(cognitoInfos, stsInfos) {

    const openIdToken = await getCognitoOpenIdToken(cognitoInfos);

    const assumeRoleWithWebIdentityCommand = new AssumeRoleWithWebIdentityCommand({
        RoleSessionName: stsInfos.sessionName,
        WebIdentityToken: openIdToken.Token,
        RoleArn: stsInfos.roleToAssumeArn
    });

    return stsClient.send(assumeRoleWithWebIdentityCommand);
}

async function createQuicksightUserIfNotExists(quicksightApi, quickSightInfos) {

    const registerUserCommand = new RegisterUserCommand({
        AwsAccountId: quickSightInfos.accountId,
        Email: quickSightInfos.user.email,
        IdentityType: 'IAM',
        Namespace: quickSightInfos.namespace,
        UserRole: quickSightInfos.user.roleName,
        IamArn: quickSightInfos.user.iamRoleArn,
        SessionName: quickSightInfos.user.sessionName
    });

    return quicksightApi.send(registerUserCommand);
}

async function getQuicksightEmbeddedUrl(quicksightApi, quickSightInfos) {

    const dashboardEmbeddedUrlCommand = new GetDashboardEmbedUrlCommand({
        AwsAccountId: quickSightInfos.accountId,
        DashboardId: quickSightInfos.dashboard.id,
        IdentityType: 'IAM',
        ResetDisabled: quickSightInfos.dashboard.disableReset,
        SessionLifetimeInMinutes: quickSightInfos.dashboard.sessionLifetime,
        UndoRedoDisabled: quickSightInfos.dashboard.disableUndoRedo
    });

    return quicksightApi.send(dashboardEmbeddedUrlCommand);
}

function errorHandler(err, req, res, next) {
    return res.status(500).json({
        status: 'error',
        message: err.message
    });
}

app.use('/', router);
app.use(errorHandler);

module.exports = app;
