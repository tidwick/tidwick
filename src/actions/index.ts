// The Action registry: one Action per file under `src/actions/<group>/<name>.ts`, each imported by name so
// `actions.<group>.<name>` is typed for pages and scripts. The import is named `<group><Name>`, since
// two groups can share a file name.
import assignmentsAdd from './assignments/add';
import assignmentsAddAll from './assignments/addAll';
import assignmentsRemove from './assignments/remove';
import auditVerify from './audit/verify';
import authAddPasskeyOptions from './auth/addPasskeyOptions';
import authAddPasskeyVerify from './auth/addPasskeyVerify';
import authEnrolOptions from './auth/enrolOptions';
import authEnrolVerify from './auth/enrolVerify';
import authDemoSignin from './auth/demoSignin';
import authLoginOptions from './auth/loginOptions';
import authLoginVerify from './auth/loginVerify';
import authLogout from './auth/logout';
import authLogoutOthers from './auth/logoutOthers';
import authRecover from './auth/recover';
import authRegenerateCodes from './auth/regenerateCodes';
import authRevokePasskey from './auth/revokePasskey';
import authStepUpOptions from './auth/stepUpOptions';
import authStepUpVerify from './auth/stepUpVerify';
import clientsArchive from './clients/archive';
import clientsCreate from './clients/create';
import clientsUpdate from './clients/update';
import entriesAddRow from './entries/addRow';
import entriesCopyLastWeek from './entries/copyLastWeek';
import entriesRemoveRow from './entries/removeRow';
import entriesSave from './entries/save';
import entriesForSave from './entriesFor/save';
import importApply from './import/apply';
import importPreview from './import/preview';
import keysRewrap from './keys/rewrap';
import peopleCreate from './people/create';
import peopleIssueEnrolment from './people/issueEnrolment';
import peopleOffboard from './people/offboard';
import peopleReenrol from './people/reenrol';
import peopleSetRoles from './people/setRoles';
import peopleUnlinkSso from './people/unlinkSso';
import peopleUnlock from './people/unlock';
import projectsArchive from './projects/archive';
import projectsCreate from './projects/create';
import projectsSetTasks from './projects/setTasks';
import projectsUpdate from './projects/update';
import settingsSave from './settings/save';
import settingsSaveCsv from './settings/saveCsv';
import setupClaim from './setup/claim';
import submissionApprove from './submission/approve';
import submissionReturn from './submission/return';
import submissionSubmit from './submission/submit';
import taskCodesArchive from './taskCodes/archive';
import taskCodesCreate from './taskCodes/create';
import taskCodesUpdate from './taskCodes/update';

export const server = {
  assignments: {
    add: assignmentsAdd,
    addAll: assignmentsAddAll,
    remove: assignmentsRemove,
  },
  audit: {
    verify: auditVerify,
  },
  auth: {
    addPasskeyOptions: authAddPasskeyOptions,
    addPasskeyVerify: authAddPasskeyVerify,
    demoSignin: authDemoSignin,
    enrolOptions: authEnrolOptions,
    enrolVerify: authEnrolVerify,
    loginOptions: authLoginOptions,
    loginVerify: authLoginVerify,
    logout: authLogout,
    logoutOthers: authLogoutOthers,
    recover: authRecover,
    regenerateCodes: authRegenerateCodes,
    revokePasskey: authRevokePasskey,
    stepUpOptions: authStepUpOptions,
    stepUpVerify: authStepUpVerify,
  },
  clients: {
    archive: clientsArchive,
    create: clientsCreate,
    update: clientsUpdate,
  },
  entries: {
    addRow: entriesAddRow,
    copyLastWeek: entriesCopyLastWeek,
    removeRow: entriesRemoveRow,
    save: entriesSave,
  },
  entriesFor: {
    save: entriesForSave,
  },
  import: {
    apply: importApply,
    preview: importPreview,
  },
  keys: {
    rewrap: keysRewrap,
  },
  people: {
    create: peopleCreate,
    issueEnrolment: peopleIssueEnrolment,
    offboard: peopleOffboard,
    reenrol: peopleReenrol,
    setRoles: peopleSetRoles,
    unlinkSso: peopleUnlinkSso,
    unlock: peopleUnlock,
  },
  projects: {
    archive: projectsArchive,
    create: projectsCreate,
    setTasks: projectsSetTasks,
    update: projectsUpdate,
  },
  settings: {
    save: settingsSave,
    saveCsv: settingsSaveCsv,
  },
  setup: {
    claim: setupClaim,
  },
  submission: {
    approve: submissionApprove,
    return: submissionReturn,
    submit: submissionSubmit,
  },
  taskCodes: {
    archive: taskCodesArchive,
    create: taskCodesCreate,
    update: taskCodesUpdate,
  },
};
