import * as React from 'react'
import { Dialog, DialogContent, DialogFooter } from '../dialog'
import { Row } from '../lib/row'
import { OkCancelButtonGroup } from '../dialog/ok-cancel-button-group'
import { PullRequest } from '../../models/pull-request'
import { Dispatcher } from '../dispatcher'
import { CICheckRunList } from '../check-runs/ci-check-run-list'
import {
  IRefCheck,
  getLatestPRWorkflowRunsLogsForCheckRun,
  getCheckRunActionsJobsAndLogURLS,
  isFailure,
  getCheckRunStepURL,
} from '../../lib/ci-checks/ci-checks'
import { Account } from '../../models/account'
import { API, IAPIWorkflowJobStep } from '../../lib/api'
import { Octicon, syncClockwise } from '../octicons'
import * as OcticonSymbol from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { RepositoryWithGitHubRepository } from '../../models/repository'
import { CICheckRunActionsJobStepList } from '../check-runs/ci-check-run-actions-job-step-list'
import { truncateWithEllipsis } from '../../lib/truncate-with-ellipsis'
import { LinkButton } from '../lib/link-button'
import { encodePathAsUrl } from '../../lib/path'

const PaperStackImage = encodePathAsUrl(__dirname, 'static/paper-stack.svg')
const BlankSlateImage = encodePathAsUrl(
  __dirname,
  'static/empty-no-pull-requests.svg'
)
const MaxCommitMessageLength = 72

interface IPullRequestChecksFailedProps {
  readonly dispatcher: Dispatcher
  readonly shouldChangeRepository: boolean
  readonly accounts: ReadonlyArray<Account>
  readonly repository: RepositoryWithGitHubRepository
  readonly pullRequest: PullRequest
  readonly commitMessage: string
  readonly commitSha: string
  readonly checks: ReadonlyArray<IRefCheck>
  readonly onSubmit: () => void
  readonly onDismissed: () => void
}

interface IPullRequestChecksFailedState {
  readonly switchingToPullRequest: boolean
  readonly selectedCheckID: number
  readonly checks: ReadonlyArray<IRefCheck>
  readonly loadingActionWorkflows: boolean
  readonly loadingActionLogs: boolean
}

/**
 * Dialog to show the result of a CI check run.
 */
export class PullRequestChecksFailed extends React.Component<
  IPullRequestChecksFailedProps,
  IPullRequestChecksFailedState
> {
  private checkRunsLoadCancelled: boolean = false

  public constructor(props: IPullRequestChecksFailedProps) {
    super(props)

    const { checks } = this.props

    const selectedCheck = checks.find(isFailure) ?? checks[0]
    this.state = {
      switchingToPullRequest: false,
      selectedCheckID: selectedCheck.id,
      checks,
      loadingActionWorkflows: true,
      loadingActionLogs: true,
    }
  }

  private get selectedCheck(): IRefCheck | undefined {
    return this.state.checks.find(
      check => check.id === this.state.selectedCheckID
    )
  }

  private get loadingChecksInfo(): boolean {
    return this.state.loadingActionWorkflows || this.state.loadingActionLogs
  }

  public render() {
    let okButtonTitle = __DARWIN__
      ? 'Switch to Pull Request'
      : 'Switch to pull request'

    if (this.props.shouldChangeRepository) {
      okButtonTitle = __DARWIN__
        ? 'Switch to Repository and Pull Request'
        : 'Switch to repository and pull request'
    }

    const { pullRequest } = this.props

    const loadingChecksInfo = this.loadingChecksInfo

    const failedChecks = this.state.checks.filter(isFailure)
    const pluralChecks = failedChecks.length > 1 ? 'checks' : 'check'

    const header = (
      <div className="ci-check-run-dialog-header">
        <Octicon symbol={OcticonSymbol.xCircleFill} />
        <div className="title-container">
          <span className="summary">
            {failedChecks.length} {pluralChecks} failed in your pull request
          </span>
          <span className="pr-title">
            <Octicon
              className={pullRequest.draft ? 'draft' : undefined}
              symbol={OcticonSymbol.gitPullRequest}
            />
            <span className="pr-title">{pullRequest.title}</span>{' '}
            <span className="pr-number">#{pullRequest.pullRequestNumber}</span>{' '}
          </span>
        </div>
        {this.renderRerunButton()}
      </div>
    )

    return (
      <Dialog
        id="pull-request-checks-failed"
        type="normal"
        title={header}
        dismissable={false}
        onSubmit={this.props.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={loadingChecksInfo || this.state.switchingToPullRequest}
      >
        <DialogContent>
          <Row>
            <div className="ci-check-run-dialog-container">
              {this.renderCheckRunHeader()}
              <div className="ci-check-run-content">
                {this.renderCheckRunJobs()}
                {this.renderCheckRunSteps()}
              </div>
            </div>
          </Row>
        </DialogContent>
        <DialogFooter>
          <Row>
            {this.renderSummary()}
            <OkCancelButtonGroup
              onCancelButtonClick={this.props.onDismissed}
              cancelButtonText="Dismiss"
              okButtonText={okButtonTitle}
              onOkButtonClick={this.onSubmit}
            />
          </Row>
        </DialogFooter>
      </Dialog>
    )
  }

  private renderSummary() {
    const failedChecks = this.state.checks.filter(isFailure)
    const pluralThem = failedChecks.length > 1 ? 'them' : 'it'
    return (
      <span className="summary">
        Do you want to switch to that Pull Request now and start fixing{' '}
        {pluralThem}?
      </span>
    )
  }

  private renderCheckRunHeader() {
    return (
      <div className="ci-check-run-header">
        <span className="message">
          {truncateWithEllipsis(
            this.props.commitMessage,
            MaxCommitMessageLength
          )}
        </span>
        <span aria-hidden="true">
          <Octicon symbol={OcticonSymbol.gitCommit} />
        </span>{' '}
        <span className="sha">{this.props.commitSha.slice(0, 9)}</span>
      </div>
    )
  }

  private renderCheckRunJobs() {
    return (
      <CICheckRunList
        checkRuns={this.state.checks}
        loadingActionLogs={this.state.loadingActionLogs}
        loadingActionWorkflows={this.state.loadingActionWorkflows}
        selectable={true}
        onViewCheckDetails={this.onViewOnGitHub}
        onCheckRunClick={this.onCheckRunClick}
      />
    )
  }

  private renderCheckRunSteps() {
    const selectedCheck = this.selectedCheck
    if (selectedCheck === undefined) {
      return null
    }

    let stepsContent = null

    if (this.loadingChecksInfo) {
      stepsContent = this.renderCheckRunStepsLoading()
    } else if (selectedCheck.actionJobSteps === undefined) {
      stepsContent = this.renderEmptyLogOutput()
    } else {
      stepsContent = (
        <CICheckRunActionsJobStepList
          steps={selectedCheck.actionJobSteps}
          onViewJobStep={this.onViewJobStep}
        />
      )
    }

    return (
      <div className="ci-check-run-job-steps-container">{stepsContent}</div>
    )
  }

  private renderCheckRunStepsLoading(): JSX.Element {
    return (
      <div className="loading-check-runs">
        <img src={BlankSlateImage} className="blankslate-image" />
        <div className="title">Stand By</div>
        <div className="call-to-action">Check run steps incoming!</div>
      </div>
    )
  }
  private renderEmptyLogOutput() {
    return (
      <div className="no-steps-to-display">
        <div className="text">
          There are no steps to display for this check.
          <div>
            <LinkButton onClick={this.onViewSelectedCheckRunOnGitHub}>
              View check details
            </LinkButton>
          </div>
        </div>
        <img src={PaperStackImage} className="blankslate-image" />
      </div>
    )
  }

  private onViewJobStep = (step: IAPIWorkflowJobStep): void => {
    const { repository, pullRequest, dispatcher } = this.props
    const checkRun = this.selectedCheck

    if (checkRun === undefined) {
      return
    }

    const url = getCheckRunStepURL(
      checkRun,
      step,
      repository.gitHubRepository,
      pullRequest.pullRequestNumber
    )

    if (url !== null) {
      dispatcher.openInBrowser(url)
    }
  }

  public componentDidMount() {
    this.loadCheckRunLogs()
  }

  public componentWillUnmount() {
    this.checkRunsLoadCancelled = true
  }

  private renderRerunButton = () => {
    const { checks } = this.state
    return (
      <div className="ci-check-rerun">
        <Button onClick={this.rerunJobs} disabled={checks.length === 0}>
          <Octicon symbol={syncClockwise} /> Re-run jobs
        </Button>
      </div>
    )
  }

  private rerunJobs = () => {
    this.props.dispatcher.rerequestCheckSuites(
      this.props.repository.gitHubRepository,
      this.state.checks
    )
  }

  private async loadCheckRunLogs() {
    const { pullRequest, repository } = this.props
    const { gitHubRepository } = repository

    const account = this.props.accounts.find(
      a => a.endpoint === gitHubRepository.endpoint
    )

    if (account === undefined) {
      this.setState({
        loadingActionWorkflows: false,
        loadingActionLogs: false,
      })
      return
    }

    const api = API.fromAccount(account)

    /*
      Until we retrieve the actions workflows, we don't know if a check run has
      action logs to output, thus, we want to show loading until then. However,
      once the workflows have been retrieved and since the logs retrieval and
      parsing can be noticeably time consuming. We go ahead and flip a flag so
      that we know we can go ahead and display the checkrun `output` content if
      a check run does not have action logs to retrieve/parse.
    */
    const checkRunsWithActionsUrls = await getCheckRunActionsJobsAndLogURLS(
      api,
      gitHubRepository.owner.login,
      gitHubRepository.name,
      pullRequest.head.ref,
      this.props.checks
    )

    if (this.checkRunsLoadCancelled) {
      return
    }

    this.setState({
      checks: checkRunsWithActionsUrls,
      loadingActionWorkflows: false,
    })

    const checks = await getLatestPRWorkflowRunsLogsForCheckRun(
      api,
      gitHubRepository.owner.login,
      gitHubRepository.name,
      checkRunsWithActionsUrls
    )

    if (this.checkRunsLoadCancelled) {
      return
    }

    this.setState({ checks, loadingActionLogs: false })
  }

  private onCheckRunClick = (checkRun: IRefCheck): void => {
    this.setState({ selectedCheckID: checkRun.id })
  }

  private onViewSelectedCheckRunOnGitHub = () => {
    const selectedCheck = this.selectedCheck
    if (selectedCheck !== undefined) {
      this.onViewOnGitHub(selectedCheck)
    }
  }

  private onViewOnGitHub = (checkRun: IRefCheck) => {
    const { repository, pullRequest, dispatcher } = this.props

    // Some checks do not provide htmlURLS like ones for the legacy status
    // object as they do not have a view in the checks screen. In that case we
    // will just open the PR and they can navigate from there... a little
    // dissatisfying tho more of an edgecase anyways.
    const url =
      checkRun.htmlUrl ??
      `${repository.gitHubRepository.htmlURL}/pull/${pullRequest.pullRequestNumber}`
    if (url === null) {
      // The repository should have a htmlURL.
      return
    }
    dispatcher.openInBrowser(url)
  }

  private onSubmit = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const { dispatcher, repository, pullRequest } = this.props

    this.setState({ switchingToPullRequest: true })
    await dispatcher.selectRepository(repository)
    await dispatcher.checkoutPullRequest(repository, pullRequest)
    this.setState({ switchingToPullRequest: false })

    this.props.onDismissed()
  }
}
