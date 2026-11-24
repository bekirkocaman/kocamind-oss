import type { Icon, IconProps } from '@phosphor-icons/react'
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise'
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft'
import { ArrowUpIcon } from '@phosphor-icons/react/dist/csr/ArrowUp'
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown'
import { CaretLeftIcon } from '@phosphor-icons/react/dist/csr/CaretLeft'
import { CaretRightIcon } from '@phosphor-icons/react/dist/csr/CaretRight'
import { ChatCircleIcon } from '@phosphor-icons/react/dist/csr/ChatCircle'
import { CheckIcon } from '@phosphor-icons/react/dist/csr/Check'
import { ClockCounterClockwiseIcon } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise'
import { ClockIcon } from '@phosphor-icons/react/dist/csr/Clock'
import { CodeIcon } from '@phosphor-icons/react/dist/csr/Code'
import { CpuIcon } from '@phosphor-icons/react/dist/csr/Cpu'
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree'
import { FilePlusIcon } from '@phosphor-icons/react/dist/csr/FilePlus'
import { FolderIcon } from '@phosphor-icons/react/dist/csr/Folder'
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen'
import { FolderPlusIcon } from '@phosphor-icons/react/dist/csr/FolderPlus'
import { ListChecksIcon } from '@phosphor-icons/react/dist/csr/ListChecks'
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass'
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus'
import { PulseIcon } from '@phosphor-icons/react/dist/csr/Pulse'
import { ShieldIcon } from '@phosphor-icons/react/dist/csr/Shield'
import { SidebarSimpleIcon } from '@phosphor-icons/react/dist/csr/SidebarSimple'
import { SignInIcon } from '@phosphor-icons/react/dist/csr/SignIn'
import { SignOutIcon } from '@phosphor-icons/react/dist/csr/SignOut'
import { SpinnerGapIcon } from '@phosphor-icons/react/dist/csr/SpinnerGap'
import { SquareIcon } from '@phosphor-icons/react/dist/csr/Square'
import { TerminalIcon } from '@phosphor-icons/react/dist/csr/Terminal'
import { TrashIcon } from '@phosphor-icons/react/dist/csr/Trash'
import { UserIcon } from '@phosphor-icons/react/dist/csr/User'
import { WarningCircleIcon } from '@phosphor-icons/react/dist/csr/WarningCircle'
import { XIcon } from '@phosphor-icons/react/dist/csr/X'

const iconDefaults = {
  size: 18,
  weight: 'regular',
  color: 'currentColor',
  'aria-hidden': 'true',
  focusable: 'false',
} as const

function PanelIcon({ caret: Caret, color = iconDefaults.color, weight = iconDefaults.weight, ...props }: IconProps & { caret: Icon }) {
  return (
    <SidebarSimpleIcon {...iconDefaults} color={color} weight={weight} {...props}>
      <Caret x={84} y={56} size={144} color={color} weight={weight} aria-hidden="true" focusable="false" />
    </SidebarSimpleIcon>
  )
}

export const IconAdd = (props: IconProps) => <PlusIcon {...iconDefaults} {...props} />
export const IconAgent = (props: IconProps) => <ListChecksIcon {...iconDefaults} {...props} />
export const IconAgentPermissions = (props: IconProps) => <ShieldIcon {...iconDefaults} {...props} />
export const IconCheck = (props: IconProps) => <CheckIcon {...iconDefaults} {...props} />
export const IconClose = (props: IconProps) => <XIcon {...iconDefaults} {...props} />
export const IconCloseLeftSidebar = (props: IconProps) => <PanelIcon caret={CaretLeftIcon} {...props} />
export const IconCloseRightPanel = (props: IconProps) => <PanelIcon caret={CaretLeftIcon} mirrored {...props} />
export const IconCode = (props: IconProps) => <CodeIcon {...iconDefaults} {...props} />
export const IconConversation = (props: IconProps) => <ChatCircleIcon {...iconDefaults} {...props} />
export const IconDelete = (props: IconProps) => <TrashIcon {...iconDefaults} {...props} />
export const IconDisclosure = (props: IconProps) => <CaretRightIcon {...iconDefaults} {...props} />
export const IconDuration = (props: IconProps) => <ClockIcon {...iconDefaults} {...props} />
export const IconError = (props: IconProps) => <WarningCircleIcon {...iconDefaults} {...props} />
export const IconExpand = (props: IconProps) => <CaretDownIcon {...iconDefaults} {...props} />
export const IconFolder = (props: IconProps) => <FolderIcon {...iconDefaults} {...props} />
export const IconHistory = (props: IconProps) => <ClockCounterClockwiseIcon {...iconDefaults} {...props} />
export const IconLoading = (props: IconProps) => <SpinnerGapIcon {...iconDefaults} {...props} />
export const IconModels = (props: IconProps) => <CpuIcon {...iconDefaults} {...props} />
export const IconMore = (props: IconProps) => <DotsThreeIcon {...iconDefaults} {...props} />
export const IconNewFile = (props: IconProps) => <FilePlusIcon {...iconDefaults} {...props} />
export const IconNewFolder = (props: IconProps) => <FolderPlusIcon {...iconDefaults} {...props} />
export const IconOpenFolder = (props: IconProps) => <FolderOpenIcon {...iconDefaults} {...props} />
export const IconOpenRightPanel = (props: IconProps) => <PanelIcon caret={CaretRightIcon} mirrored {...props} />
export const IconProfile = (props: IconProps) => <UserIcon {...iconDefaults} {...props} />
export const IconResumeSession = IconHistory
export const IconRetry = (props: IconProps) => <ArrowClockwiseIcon {...iconDefaults} {...props} />
export const IconSearch = (props: IconProps) => <MagnifyingGlassIcon {...iconDefaults} {...props} />
export const IconSendMessage = (props: IconProps) => <ArrowUpIcon {...iconDefaults} {...props} />
export const IconSidebar = (props: IconProps) => <SidebarSimpleIcon {...iconDefaults} {...props} />
export const IconSignIn = (props: IconProps) => <SignInIcon {...iconDefaults} {...props} />
export const IconSignOut = (props: IconProps) => <SignOutIcon {...iconDefaults} {...props} />
export const IconStop = (props: IconProps) => <SquareIcon {...iconDefaults} {...props} />
export const IconTerminal = (props: IconProps) => <TerminalIcon {...iconDefaults} {...props} />
export const IconTrace = (props: IconProps) => <PulseIcon {...iconDefaults} {...props} />
export const IconUndo = (props: IconProps) => <ArrowUUpLeftIcon {...iconDefaults} {...props} />
