/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  AdminConfig,
  DanmuCustomNode,
  PrivateLibraryConnector,
} from '@/lib/admin.types';
import { normalizeApkDownloadUrl } from '@/lib/apk-download';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { getLiveSourceSortOrder } from '@/lib/live-source-options';

import {
  AlertModal,
  buttonStyles,
  type CustomCategory,
  showError,
  showSuccess,
  type SiteConfig,
  SortableTableRow,
  useAlertModal,
  useLoadingState,
} from '@/components/admin-manage/admin-shared';

// 用户配置组件
interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  storageMode: 'cloud' | 'local';
  refreshConfig: () => Promise<void>;
}

export const UserConfig = ({
  config,
  role,
  storageMode,
  refreshConfig,
}: UserConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [showAddUserGroupForm, setShowAddUserGroupForm] = useState(false);
  const [showEditUserGroupForm, setShowEditUserGroupForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    userGroup: '', // 新增用户组字段
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  const [newUserGroup, setNewUserGroup] = useState({
    name: '',
    enabledApis: [] as string[],
  });
  const [editingUserGroup, setEditingUserGroup] = useState<{
    name: string;
    enabledApis: string[];
  } | null>(null);
  const [showConfigureApisModal, setShowConfigureApisModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
    tags?: string[];
  } | null>(null);
  const [selectedApis, setSelectedApis] = useState<string[]>([]);
  const [showConfigureUserGroupModal, setShowConfigureUserGroupModal] =
    useState(false);
  const [selectedUserForGroup, setSelectedUserForGroup] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  } | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showBatchUserGroupModal, setShowBatchUserGroupModal] = useState(false);
  const [selectedUserGroup, setSelectedUserGroup] = useState<string>('');
  const [showDeleteUserGroupModal, setShowDeleteUserGroupModal] =
    useState(false);
  const [deletingUserGroup, setDeletingUserGroup] = useState<{
    name: string;
    affectedUsers: Array<{
      username: string;
      role: 'user' | 'admin' | 'owner';
    }>;
  } | null>(null);
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // 当前登录用户名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;

  // 使用 useMemo 计算全选状态，避免每次渲染都重新计算
  const selectAllUsers = useMemo(() => {
    const selectableUserCount =
      config?.UserConfig?.Users?.filter(
        (user) =>
          role === 'owner' ||
          (role === 'admin' &&
            (user.role === 'user' || user.username === currentUsername)),
      ).length || 0;
    return selectedUsers.size === selectableUserCount && selectedUsers.size > 0;
  }, [selectedUsers.size, config?.UserConfig?.Users, role, currentUsername]);

  // 获取用户组列表
  const userGroups = config?.UserConfig?.Tags || [];
  const registrationEnabled = config?.UserConfig?.RegistrationEnabled === true;
  const registrationDefaultUserGroup =
    config?.UserConfig?.RegistrationDefaultUserGroup || '';
  const registrationDefaultGroupExists =
    !registrationDefaultUserGroup ||
    userGroups.some((group) => group.name === registrationDefaultUserGroup);
  const canManageRegistration = role === 'owner' && storageMode !== 'local';

  const handleRegistrationSettingsChange = async (
    enabled: boolean,
    defaultUserGroup: string,
    successMessage = enabled ? '公开注册已开启' : '公开注册已关闭',
  ) => {
    await withLoading('saveRegistrationSettings', async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'updateRegistrationSettings',
            registrationEnabled: enabled,
            registrationDefaultUserGroup: defaultUserGroup,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `保存失败: ${res.status}`);
        }

        await refreshConfig();
        showSuccess(successMessage, showAlert);
      } catch (err) {
        showError(
          err instanceof Error ? err.message : '保存注册设置失败',
          showAlert,
        );
      }
    });
  };

  // 处理用户组相关操作
  const handleUserGroupAction = async (
    action: 'add' | 'edit' | 'delete',
    groupName: string,
    enabledApis?: string[],
  ) => {
    return withLoading(`userGroup_${action}_${groupName}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'userGroup',
            groupAction: action,
            groupName,
            enabledApis,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        await refreshConfig();

        if (action === 'add') {
          setNewUserGroup({ name: '', enabledApis: [] });
          setShowAddUserGroupForm(false);
        } else if (action === 'edit') {
          setEditingUserGroup(null);
          setShowEditUserGroupForm(false);
        }

        showSuccess(
          action === 'add'
            ? '用户组添加成功'
            : action === 'edit'
              ? '用户组更新成功'
              : '用户组删除成功',
          showAlert,
        );
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleAddUserGroup = () => {
    if (!newUserGroup.name.trim()) return;
    handleUserGroupAction('add', newUserGroup.name, newUserGroup.enabledApis);
  };

  const handleEditUserGroup = () => {
    if (!editingUserGroup?.name.trim()) return;
    handleUserGroupAction(
      'edit',
      editingUserGroup.name,
      editingUserGroup.enabledApis,
    );
  };

  const handleDeleteUserGroup = (groupName: string) => {
    // 计算会受影响的用户数量
    const affectedUsers =
      config?.UserConfig?.Users?.filter(
        (user) => user.tags && user.tags.includes(groupName),
      ) || [];

    setDeletingUserGroup({
      name: groupName,
      affectedUsers: affectedUsers.map((u) => ({
        username: u.username,
        role: u.role,
      })),
    });
    setShowDeleteUserGroupModal(true);
  };

  const handleConfirmDeleteUserGroup = async () => {
    if (!deletingUserGroup) return;

    try {
      await handleUserGroupAction('delete', deletingUserGroup.name);
      setShowDeleteUserGroupModal(false);
      setDeletingUserGroup(null);
    } catch {
      // 错误处理已在 handleUserGroupAction 中处理
    }
  };

  const handleStartEditUserGroup = (group: {
    name: string;
    enabledApis: string[];
  }) => {
    setEditingUserGroup({ ...group });
    setShowEditUserGroupForm(true);
    setShowAddUserGroupForm(false);
  };

  // 为用户分配用户组
  const handleAssignUserGroup = async (
    username: string,
    userGroups: string[],
  ) => {
    return withLoading(`assignUserGroup_${username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: username,
            action: 'updateUserGroups',
            userGroups,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        await refreshConfig();
        showSuccess('用户组分配成功', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleBanUser = async (uname: string) => {
    await withLoading(`banUser_${uname}`, () => handleUserAction('ban', uname));
  };

  const handleUnbanUser = async (uname: string) => {
    await withLoading(`unbanUser_${uname}`, () =>
      handleUserAction('unban', uname),
    );
  };

  const handleSetAdmin = async (uname: string) => {
    await withLoading(`setAdmin_${uname}`, () =>
      handleUserAction('setAdmin', uname),
    );
  };

  const handleRemoveAdmin = async (uname: string) => {
    await withLoading(`removeAdmin_${uname}`, () =>
      handleUserAction('cancelAdmin', uname),
    );
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await withLoading('addUser', async () => {
      await handleUserAction(
        'add',
        newUser.username,
        newUser.password,
        newUser.userGroup,
      );
      setNewUser({ username: '', password: '', userGroup: '' });
      setShowAddUserForm(false);
    });
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await withLoading(
      `changePassword_${changePasswordUser.username}`,
      async () => {
        await handleUserAction(
          'changePassword',
          changePasswordUser.username,
          changePasswordUser.password,
        );
        setChangePasswordUser({ username: '', password: '' });
        setShowChangePasswordForm(false);
      },
    );
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 关闭添加用户表单
  };

  const handleDeleteUser = (username: string) => {
    setDeletingUser(username);
    setShowDeleteUserModal(true);
  };

  const handleConfigureUserApis = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
  }) => {
    setSelectedUser(user);
    setSelectedApis(user.enabledApis || []);
    setShowConfigureApisModal(true);
  };

  const handleConfigureUserGroup = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  }) => {
    setSelectedUserForGroup(user);
    setSelectedUserGroups(user.tags || []);
    setShowConfigureUserGroupModal(true);
  };

  const handleSaveUserGroups = async () => {
    if (!selectedUserForGroup) return;

    await withLoading(
      `saveUserGroups_${selectedUserForGroup.username}`,
      async () => {
        try {
          await handleAssignUserGroup(
            selectedUserForGroup.username,
            selectedUserGroups,
          );
          setShowConfigureUserGroupModal(false);
          setSelectedUserForGroup(null);
          setSelectedUserGroups([]);
        } catch {
          // 错误处理已在 handleAssignUserGroup 中处理
        }
      },
    );
  };

  // 处理用户选择
  const handleSelectUser = useCallback((username: string, checked: boolean) => {
    setSelectedUsers((prev) => {
      const newSelectedUsers = new Set(prev);
      if (checked) {
        newSelectedUsers.add(username);
      } else {
        newSelectedUsers.delete(username);
      }
      return newSelectedUsers;
    });
  }, []);

  const handleSelectAllUsers = useCallback(
    (checked: boolean) => {
      if (checked) {
        // 只选择自己有权限操作的用户
        const selectableUsernames =
          config?.UserConfig?.Users?.filter(
            (user) =>
              role === 'owner' ||
              (role === 'admin' &&
                (user.role === 'user' || user.username === currentUsername)),
          ).map((u) => u.username) || [];
        setSelectedUsers(new Set(selectableUsernames));
      } else {
        setSelectedUsers(new Set());
      }
    },
    [config?.UserConfig?.Users, role, currentUsername],
  );

  // 批量设置用户组
  const handleBatchSetUserGroup = async (userGroup: string) => {
    if (selectedUsers.size === 0) return;

    await withLoading('batchSetUserGroup', async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batchUpdateUserGroups',
            usernames: Array.from(selectedUsers),
            userGroups: userGroup === '' ? [] : [userGroup],
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        const userCount = selectedUsers.size;
        setSelectedUsers(new Set());
        setShowBatchUserGroupModal(false);
        setSelectedUserGroup('');
        showSuccess(
          `已为 ${userCount} 个用户设置用户组: ${userGroup}`,
          showAlert,
        );

        // 刷新配置
        await refreshConfig();
      } catch (err) {
        showError('批量设置用户组失败', showAlert);
        throw err;
      }
    });
  };

  // 提取URL域名的辅助函数
  const extractDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      // 如果URL格式不正确，返回原字符串
      return url;
    }
  };

  const handleSaveUserApis = async () => {
    if (!selectedUser) return;

    await withLoading(`saveUserApis_${selectedUser.username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: selectedUser.username,
            action: 'updateUserApis',
            enabledApis: selectedApis,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        // 成功后刷新配置
        await refreshConfig();
        setShowConfigureApisModal(false);
        setSelectedUser(null);
        setSelectedApis([]);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  // 通用请求函数
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser',
    targetUsername: string,
    targetPassword?: string,
    userGroup?: string,
  ) => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          ...(userGroup ? { userGroup } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      // 成功后刷新配置（无需整页刷新）
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;

    await withLoading(`deleteUser_${deletingUser}`, async () => {
      try {
        await handleUserAction('deleteUser', deletingUser);
        setShowDeleteUserModal(false);
        setDeletingUser(null);
      } catch {
        // 错误处理已在 handleUserAction 中处理
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 公开注册策略 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          公开注册
        </h4>
        <div className='space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div>
              <div className='flex items-center gap-2'>
                <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                  允许访客自行注册账号
                </p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    storageMode === 'local'
                      ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                      : registrationEnabled
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                        : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {storageMode === 'local'
                    ? '存储不支持'
                    : registrationEnabled
                      ? '开放中'
                      : '已关闭'}
                </span>
              </div>
              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                开启后，登录页会出现注册入口；关闭后服务端立即拒绝新的注册请求。
              </p>
            </div>
            <button
              type='button'
              role='switch'
              aria-label='允许访客自行注册账号'
              aria-checked={registrationEnabled}
              onClick={() =>
                void handleRegistrationSettingsChange(
                  !registrationEnabled,
                  registrationDefaultUserGroup,
                )
              }
              disabled={
                !canManageRegistration || isLoading('saveRegistrationSettings')
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                registrationEnabled
                  ? buttonStyles.toggleOn
                  : buttonStyles.toggleOff
              } ${
                !canManageRegistration || isLoading('saveRegistrationSettings')
                  ? 'cursor-not-allowed opacity-50'
                  : ''
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full ${
                  buttonStyles.toggleThumb
                } transition-transform ${
                  registrationEnabled
                    ? buttonStyles.toggleThumbOn
                    : buttonStyles.toggleThumbOff
                }`}
              />
            </button>
          </div>

          <div>
            <label
              htmlFor='registration-default-user-group'
              className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'
            >
              新注册用户默认用户组
            </label>
            <select
              id='registration-default-user-group'
              value={registrationDefaultUserGroup}
              onChange={(event) =>
                void handleRegistrationSettingsChange(
                  registrationEnabled,
                  event.target.value,
                  '默认注册用户组已更新',
                )
              }
              disabled={
                !canManageRegistration || isLoading('saveRegistrationSettings')
              }
              className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
            >
              <option value=''>不分配用户组（默认拥有全部可用视频源）</option>
              {!registrationDefaultGroupExists && (
                <option value={registrationDefaultUserGroup}>
                  已失效：{registrationDefaultUserGroup}
                </option>
              )}
              {userGroups.map((group) => (
                <option key={group.name} value={group.name}>
                  {group.name}
                </option>
              ))}
            </select>
            {!registrationDefaultUserGroup && registrationEnabled && (
              <p className='mt-2 text-xs text-yellow-700 dark:text-yellow-300'>
                当前未设置默认用户组，新注册用户将不受用户组的视频源限制。
              </p>
            )}
            {!registrationDefaultGroupExists && (
              <p className='mt-2 text-xs text-red-600 dark:text-red-400'>
                当前默认用户组已不存在，请重新选择；在修复前新用户不会自动分组。
              </p>
            )}
            {storageMode === 'local' && (
              <p className='mt-2 text-xs text-yellow-700 dark:text-yellow-300'>
                LocalStorage 模式不支持多用户注册。配置 Redis、Upstash 或
                Kvrocks 后即可在这里开启。
              </p>
            )}
            {role !== 'owner' && storageMode !== 'local' && (
              <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                公开开放账号创建属于站点安全策略，仅站长可以修改。
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 用户统计 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          用户统计
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            总用户数
          </div>
        </div>
      </div>

      {/* 用户组管理 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户组管理
          </h4>
          <button
            onClick={() => {
              setShowAddUserGroupForm(!showAddUserGroupForm);
              if (showEditUserGroupForm) {
                setShowEditUserGroupForm(false);
                setEditingUserGroup(null);
              }
            }}
            className={
              showAddUserGroupForm
                ? buttonStyles.secondary
                : buttonStyles.primary
            }
          >
            {showAddUserGroupForm ? '取消' : '添加用户组'}
          </button>
        </div>

        {/* 用户组列表 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-80 overflow-y-auto overflow-x-auto relative'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  用户组名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  可用视频源
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
              {userGroups.map((group) => (
                <tr
                  key={group.name}
                  className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                >
                  <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {group.name}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center space-x-2'>
                      <span className='text-sm text-gray-900 dark:text-gray-100'>
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `${group.enabledApis.length} 个源`
                          : '无限制'}
                      </span>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                    <button
                      onClick={() => handleStartEditUserGroup(group)}
                      disabled={isLoading(`userGroup_edit_${group.name}`)}
                      className={`${buttonStyles.roundedPrimary} ${
                        isLoading(`userGroup_edit_${group.name}`)
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDeleteUserGroup(group.name)}
                      className={buttonStyles.roundedDanger}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {userGroups.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className='px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400'
                  >
                    暂无用户组，请添加用户组来管理用户权限
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 用户列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户列表
          </h4>
          <div className='flex items-center space-x-2'>
            {/* 批量操作按钮 */}
            {selectedUsers.size > 0 && (
              <>
                <div className='flex items-center space-x-3'>
                  <span className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择 {selectedUsers.size} 个用户
                  </span>
                  <button
                    onClick={() => setShowBatchUserGroupModal(true)}
                    className={buttonStyles.primary}
                  >
                    批量设置用户组
                  </button>
                </div>
                <div className='w-px h-6 bg-gray-300 dark:bg-gray-600'></div>
              </>
            )}
            <button
              onClick={() => {
                setShowAddUserForm(!showAddUserForm);
                if (showChangePasswordForm) {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }
              }}
              className={
                showAddUserForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddUserForm ? '取消' : '添加用户'}
            </button>
          </div>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <input
                  type='text'
                  placeholder='用户名'
                  value={newUser.username}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
                <input
                  type='password'
                  placeholder='密码'
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  用户组（可选）
                </label>
                <select
                  value={newUser.userGroup}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      userGroup: e.target.value,
                    }))
                  }
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                >
                  <option value=''>无用户组（无限制）</option>
                  {userGroups.map((group) => (
                    <option key={group.name} value={group.name}>
                      {group.name} (
                      {group.enabledApis && group.enabledApis.length > 0
                        ? `${group.enabledApis.length} 个源`
                        : '无限制'}
                      )
                    </option>
                  ))}
                </select>
              </div>
              <div className='flex justify-end'>
                <button
                  onClick={handleAddUser}
                  disabled={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                  }
                  className={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                      ? buttonStyles.disabled
                      : buttonStyles.success
                  }
                >
                  {isLoading('addUser') ? '添加中...' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 修改密码表单 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改用户密码
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密码'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                }
                className={`w-full sm:w-auto ${
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                    ? buttonStyles.disabled
                    : buttonStyles.primary
                }`}
              >
                {isLoading(`changePassword_${changePasswordUser.username}`)
                  ? '修改中...'
                  : '修改密码'}
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className={`w-full sm:w-auto ${buttonStyles.secondary}`}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 用户列表 */}
        <div
          className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
          data-table='user-list'
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-4' />
                <th className='w-10 px-1 py-3 text-center'>
                  {(() => {
                    // 检查是否有权限操作任何用户
                    const hasAnyPermission = config?.UserConfig?.Users?.some(
                      (user) =>
                        role === 'owner' ||
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername)),
                    );

                    return hasAnyPermission ? (
                      <input
                        type='checkbox'
                        checked={selectAllUsers}
                        onChange={(e) => handleSelectAllUsers(e.target.checked)}
                        className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                      />
                    ) : (
                      <div className='w-4 h-4' />
                    );
                  })()}
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  状态
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户组
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  采集源权限
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  return 3;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {sortedUsers.map((user) => {
                    // 修改密码权限：站长可修改管理员和普通用户密码，管理员可修改普通用户和自己的密码，但任何人都不能修改站长密码
                    const canChangePassword =
                      user.role !== 'owner' && // 不能修改站长密码
                      (role === 'owner' || // 站长可以修改管理员和普通用户密码
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername))); // 管理员可以修改普通用户和自己的密码

                    // 删除用户权限：站长可删除除自己外的所有用户，管理员仅可删除普通用户
                    const canDeleteUser =
                      user.username !== currentUsername &&
                      (role === 'owner' || // 站长可以删除除自己外的所有用户
                        (role === 'admin' && user.role === 'user')); // 管理员仅可删除普通用户

                    // 其他操作权限：不能操作自己，站长可操作所有用户，管理员可操作普通用户
                    const canOperate =
                      user.username !== currentUsername &&
                      (role === 'owner' ||
                        (role === 'admin' && user.role === 'user'));
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                      >
                        <td className='w-4' />
                        <td className='w-10 px-1 py-3 text-center'>
                          {role === 'owner' ||
                          (role === 'admin' &&
                            (user.role === 'user' ||
                              user.username === currentUsername)) ? (
                            <input
                              type='checkbox'
                              checked={selectedUsers.has(user.username)}
                              onChange={(e) =>
                                handleSelectUser(
                                  user.username,
                                  e.target.checked,
                                )
                              }
                              className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                            />
                          ) : (
                            <div className='w-4 h-4' />
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              user.role === 'owner'
                                ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                : user.role === 'admin'
                                  ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {user.role === 'owner'
                              ? '站长'
                              : user.role === 'admin'
                                ? '管理员'
                                : '普通用户'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              !user.banned
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {!user.banned ? '正常' : '已封禁'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-gray-900 dark:text-gray-100'>
                              {user.tags && user.tags.length > 0
                                ? user.tags.join(', ')
                                : '无用户组'}
                            </span>
                            {/* 配置用户组按钮 */}
                            {(role === 'owner' ||
                              (role === 'admin' &&
                                (user.role === 'user' ||
                                  user.username === currentUsername))) && (
                              <button
                                onClick={() => handleConfigureUserGroup(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                配置
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-gray-900 dark:text-gray-100'>
                              {user.enabledApis && user.enabledApis.length > 0
                                ? `${user.enabledApis.length} 个源`
                                : '无限制'}
                            </span>
                            {/* 配置采集源权限按钮 */}
                            {(role === 'owner' ||
                              (role === 'admin' &&
                                (user.role === 'user' ||
                                  user.username === currentUsername))) && (
                              <button
                                onClick={() => handleConfigureUserApis(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                配置
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密码按钮 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className={buttonStyles.roundedPrimary}
                            >
                              修改密码
                            </button>
                          )}
                          {canOperate && (
                            <>
                              {/* 其他操作按钮 */}
                              {user.role === 'user' && (
                                <button
                                  onClick={() => handleSetAdmin(user.username)}
                                  disabled={isLoading(
                                    `setAdmin_${user.username}`,
                                  )}
                                  className={`${buttonStyles.roundedPurple} ${
                                    isLoading(`setAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  设为管理
                                </button>
                              )}
                              {user.role === 'admin' && (
                                <button
                                  onClick={() =>
                                    handleRemoveAdmin(user.username)
                                  }
                                  disabled={isLoading(
                                    `removeAdmin_${user.username}`,
                                  )}
                                  className={`${
                                    buttonStyles.roundedSecondary
                                  } ${
                                    isLoading(`removeAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  取消管理
                                </button>
                              )}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    disabled={isLoading(
                                      `banUser_${user.username}`,
                                    )}
                                    className={`${buttonStyles.roundedDanger} ${
                                      isLoading(`banUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    disabled={isLoading(
                                      `unbanUser_${user.username}`,
                                    )}
                                    className={`${
                                      buttonStyles.roundedSuccess
                                    } ${
                                      isLoading(`unbanUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
                              className={buttonStyles.roundedDanger}
                            >
                              删除用户
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })()}
          </table>
        </div>
      </div>

      {/* 配置用户采集源权限弹窗 */}
      {showConfigureApisModal &&
        selectedUser &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowConfigureApisModal(false);
              setSelectedUser(null);
              setSelectedApis([]);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    配置用户采集源权限 - {selectedUser.username}
                  </h3>
                  <button
                    onClick={() => {
                      setShowConfigureApisModal(false);
                      setSelectedUser(null);
                      setSelectedApis([]);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-blue-600 dark:text-blue-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                        配置说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400 mt-1'>
                      提示：全不选为无限制，选中的采集源将限制用户只能访问这些源
                    </p>
                  </div>
                </div>

                {/* 采集源选择 - 多列布局 */}
                <div className='mb-6'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                    选择可用的采集源：
                  </h4>
                  <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                    {config?.SourceConfig?.map((source) => (
                      <label
                        key={source.key}
                        className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                      >
                        <input
                          type='checkbox'
                          checked={selectedApis.includes(source.key)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedApis([...selectedApis, source.key]);
                            } else {
                              setSelectedApis(
                                selectedApis.filter(
                                  (api) => api !== source.key,
                                ),
                              );
                            }
                          }}
                          className='rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                        />
                        <div className='flex-1 min-w-0'>
                          <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                            {source.name}
                          </div>
                          {source.api && (
                            <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                              {extractDomain(source.api)}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 快速操作按钮 */}
                <div className='flex flex-wrap items-center justify-between mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg'>
                  <div className='flex space-x-2'>
                    <button
                      onClick={() => setSelectedApis([])}
                      className={buttonStyles.quickAction}
                    >
                      全不选（无限制）
                    </button>
                    <button
                      onClick={() => {
                        const allApis =
                          config?.SourceConfig?.filter(
                            (source) => !source.disabled,
                          ).map((s) => s.key) || [];
                        setSelectedApis(allApis);
                      }}
                      className={buttonStyles.quickAction}
                    >
                      全选
                    </button>
                  </div>
                  <div className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择：
                    <span className='font-medium text-blue-600 dark:text-blue-400'>
                      {selectedApis.length > 0
                        ? `${selectedApis.length} 个源`
                        : '无限制'}
                    </span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowConfigureApisModal(false);
                      setSelectedUser(null);
                      setSelectedApis([]);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveUserApis}
                    disabled={isLoading(
                      `saveUserApis_${selectedUser?.username}`,
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(`saveUserApis_${selectedUser?.username}`)
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading(`saveUserApis_${selectedUser?.username}`)
                      ? '配置中...'
                      : '确认配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 添加用户组弹窗 */}
      {showAddUserGroupForm &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowAddUserGroupForm(false);
              setNewUserGroup({ name: '', enabledApis: [] });
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    添加新用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowAddUserGroupForm(false);
                      setNewUserGroup({ name: '', enabledApis: [] });
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='space-y-6'>
                  {/* 用户组名称 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      用户组名称
                    </label>
                    <input
                      type='text'
                      placeholder='请输入用户组名称'
                      value={newUserGroup.name}
                      onChange={(e) =>
                        setNewUserGroup((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                    />
                  </div>

                  {/* 可用视频源 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      可用视频源
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                      {config?.SourceConfig?.map((source) => (
                        <label
                          key={source.key}
                          className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={newUserGroup.enabledApis.includes(
                              source.key,
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  enabledApis: [
                                    ...prev.enabledApis,
                                    source.key,
                                  ],
                                }));
                              } else {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  enabledApis: prev.enabledApis.filter(
                                    (api) => api !== source.key,
                                  ),
                                }));
                              }
                            }}
                            className='rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                              {source.name}
                            </div>
                            {source.api && (
                              <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                                {extractDomain(source.api)}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 快速操作按钮 */}
                    <div className='mt-4 flex space-x-2'>
                      <button
                        onClick={() =>
                          setNewUserGroup((prev) => ({
                            ...prev,
                            enabledApis: [],
                          }))
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选（无限制）
                      </button>
                      <button
                        onClick={() => {
                          const allApis =
                            config?.SourceConfig?.filter(
                              (source) => !source.disabled,
                            ).map((s) => s.key) || [];
                          setNewUserGroup((prev) => ({
                            ...prev,
                            enabledApis: allApis,
                          }));
                        }}
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
                    <button
                      onClick={() => {
                        setShowAddUserGroupForm(false);
                        setNewUserGroup({ name: '', enabledApis: [] });
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleAddUserGroup}
                      disabled={
                        !newUserGroup.name.trim() ||
                        isLoading('userGroup_add_new')
                      }
                      className={`px-6 py-2.5 text-sm font-medium ${
                        !newUserGroup.name.trim() ||
                        isLoading('userGroup_add_new')
                          ? buttonStyles.disabled
                          : buttonStyles.primary
                      }`}
                    >
                      {isLoading('userGroup_add_new')
                        ? '添加中...'
                        : '添加用户组'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 编辑用户组弹窗 */}
      {showEditUserGroupForm &&
        editingUserGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowEditUserGroupForm(false);
              setEditingUserGroup(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    编辑用户组 - {editingUserGroup.name}
                  </h3>
                  <button
                    onClick={() => {
                      setShowEditUserGroupForm(false);
                      setEditingUserGroup(null);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='space-y-6'>
                  {/* 可用视频源 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      可用视频源
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                      {config?.SourceConfig?.map((source) => (
                        <label
                          key={source.key}
                          className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={editingUserGroup.enabledApis.includes(
                              source.key,
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        enabledApis: [
                                          ...prev.enabledApis,
                                          source.key,
                                        ],
                                      }
                                    : null,
                                );
                              } else {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        enabledApis: prev.enabledApis.filter(
                                          (api) => api !== source.key,
                                        ),
                                      }
                                    : null,
                                );
                              }
                            }}
                            className='rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                              {source.name}
                            </div>
                            {source.api && (
                              <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                                {extractDomain(source.api)}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 快速操作按钮 */}
                    <div className='mt-4 flex space-x-2'>
                      <button
                        onClick={() =>
                          setEditingUserGroup((prev) =>
                            prev ? { ...prev, enabledApis: [] } : null,
                          )
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选（无限制）
                      </button>
                      <button
                        onClick={() => {
                          const allApis =
                            config?.SourceConfig?.filter(
                              (source) => !source.disabled,
                            ).map((s) => s.key) || [];
                          setEditingUserGroup((prev) =>
                            prev ? { ...prev, enabledApis: allApis } : null,
                          );
                        }}
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
                    <button
                      onClick={() => {
                        setShowEditUserGroupForm(false);
                        setEditingUserGroup(null);
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleEditUserGroup}
                      disabled={isLoading(
                        `userGroup_edit_${editingUserGroup?.name}`,
                      )}
                      className={`px-6 py-2.5 text-sm font-medium ${
                        isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                          ? buttonStyles.disabled
                          : buttonStyles.primary
                      }`}
                    >
                      {isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                        ? '保存中...'
                        : '保存修改'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 配置用户组弹窗 */}
      {showConfigureUserGroupModal &&
        selectedUserForGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowConfigureUserGroupModal(false);
              setSelectedUserForGroup(null);
              setSelectedUserGroups([]);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    配置用户组 - {selectedUserForGroup.username}
                  </h3>
                  <button
                    onClick={() => {
                      setShowConfigureUserGroupModal(false);
                      setSelectedUserForGroup(null);
                      setSelectedUserGroups([]);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-blue-600 dark:text-blue-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                        配置说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400 mt-1'>
                      提示：选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                    </p>
                  </div>
                </div>

                {/* 用户组选择 - 下拉选择器 */}
                <div className='mb-6'>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    选择用户组：
                  </label>
                  <select
                    value={
                      selectedUserGroups.length > 0 ? selectedUserGroups[0] : ''
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedUserGroups(value ? [value] : []);
                    }}
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'
                  >
                    <option value=''>无用户组（无限制）</option>
                    {userGroups.map((group) => (
                      <option key={group.name} value={group.name}>
                        {group.name}{' '}
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `(${group.enabledApis.length} 个源)`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                    选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                  </p>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowConfigureUserGroupModal(false);
                      setSelectedUserForGroup(null);
                      setSelectedUserGroups([]);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveUserGroups}
                    disabled={isLoading(
                      `saveUserGroups_${selectedUserForGroup?.username}`,
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(
                        `saveUserGroups_${selectedUserForGroup?.username}`,
                      )
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading(
                      `saveUserGroups_${selectedUserForGroup?.username}`,
                    )
                      ? '配置中...'
                      : '确认配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 删除用户组确认弹窗 */}
      {showDeleteUserGroupModal &&
        deletingUserGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowDeleteUserGroupModal(false);
              setDeletingUserGroup(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认删除用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowDeleteUserGroupModal(false);
                      setDeletingUserGroup(null);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-red-600 dark:text-red-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                        危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-red-700 dark:text-red-400'>
                      删除用户组 <strong>{deletingUserGroup.name}</strong>{' '}
                      将影响所有使用该组的用户，此操作不可恢复！
                    </p>
                  </div>

                  {deletingUserGroup.affectedUsers.length > 0 ? (
                    <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4'>
                      <div className='flex items-center space-x-2 mb-2'>
                        <svg
                          className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                        </svg>
                        <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                          ⚠️ 将影响 {deletingUserGroup.affectedUsers.length}{' '}
                          个用户：
                        </span>
                      </div>
                      <div className='space-y-1'>
                        {deletingUserGroup.affectedUsers.map((user, index) => (
                          <div
                            key={index}
                            className='text-sm text-yellow-700 dark:text-yellow-300'
                          >
                            • {user.username} ({user.role})
                          </div>
                        ))}
                      </div>
                      <p className='text-xs text-yellow-600 dark:text-yellow-400 mt-2'>
                        这些用户的用户组将被自动移除
                      </p>
                    </div>
                  ) : (
                    <div className='bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4'>
                      <div className='flex items-center space-x-2'>
                        <svg
                          className='w-5 h-5 text-green-600 dark:text-green-400'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M5 13l4 4L19 7'
                          />
                        </svg>
                        <span className='text-sm font-medium text-green-800 dark:text-green-300'>
                          ✅ 当前没有用户使用此用户组
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowDeleteUserGroupModal(false);
                      setDeletingUserGroup(null);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmDeleteUserGroup}
                    disabled={isLoading(
                      `userGroup_delete_${deletingUserGroup?.name}`,
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }`}
                  >
                    {isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
                      ? '删除中...'
                      : '确认删除'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 删除用户确认弹窗 */}
      {showDeleteUserModal &&
        deletingUser &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowDeleteUserModal(false);
              setDeletingUser(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认删除用户
                  </h3>
                  <button
                    onClick={() => {
                      setShowDeleteUserModal(false);
                      setDeletingUser(null);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-red-600 dark:text-red-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                        危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-red-700 dark:text-red-400'>
                      删除用户 <strong>{deletingUser}</strong>{' '}
                      将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！
                    </p>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3'>
                    <button
                      onClick={() => {
                        setShowDeleteUserModal(false);
                        setDeletingUser(null);
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleConfirmDeleteUser}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.danger}`}
                    >
                      确认删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 批量设置用户组弹窗 */}
      {showBatchUserGroupModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowBatchUserGroupModal(false);
              setSelectedUserGroup('');
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    批量设置用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowBatchUserGroupModal(false);
                      setSelectedUserGroup('');
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth={2}
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div className='mb-6'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-blue-600 dark:text-blue-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                        批量操作说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400'>
                      将为选中的 <strong>{selectedUsers.size} 个用户</strong>{' '}
                      设置用户组，选择"无用户组"为无限制
                    </p>
                  </div>

                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      选择用户组：
                    </label>
                    <select
                      onChange={(e) => setSelectedUserGroup(e.target.value)}
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'
                      value={selectedUserGroup}
                    >
                      <option value=''>无用户组（无限制）</option>
                      {userGroups.map((group) => (
                        <option key={group.name} value={group.name}>
                          {group.name}{' '}
                          {group.enabledApis && group.enabledApis.length > 0
                            ? `(${group.enabledApis.length} 个源)`
                            : ''}
                        </option>
                      ))}
                    </select>
                    <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                      选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                    </p>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowBatchUserGroupModal(false);
                      setSelectedUserGroup('');
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleBatchSetUserGroup(selectedUserGroup)}
                    disabled={isLoading('batchSetUserGroup')}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading('batchSetUserGroup')
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading('batchSetUserGroup') ? '设置中...' : '确认设置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
        onConfirm={alertModal.onConfirm}
        confirmText={alertModal.confirmText}
        cancelText={alertModal.cancelText}
      />
    </div>
  );
};

// 分类配置组件
export const CategoryConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [categories, setCategories] = useState<CustomCategory[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newCategory, setNewCategory] = useState<CustomCategory>({
    name: '',
    type: 'movie',
    query: '',
    disabled: false,
    from: 'config',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.CustomCategories) {
      setCategories(config.CustomCategories);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callCategoryApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (query: string, type: 'movie' | 'tv') => {
    const target = categories.find((c) => c.query === query && c.type === type);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleCategory_${query}_${type}`, () =>
      callCategoryApi({ action, query, type }),
    ).catch(() => {
      console.error('操作失败', action, query, type);
    });
  };

  const handleDelete = (query: string, type: 'movie' | 'tv') => {
    withLoading(`deleteCategory_${query}_${type}`, () =>
      callCategoryApi({ action: 'delete', query, type }),
    ).catch(() => {
      console.error('操作失败', 'delete', query, type);
    });
  };

  const handleAddCategory = () => {
    if (!newCategory.name || !newCategory.query) return;
    withLoading('addCategory', async () => {
      await callCategoryApi({
        action: 'add',
        name: newCategory.name,
        type: newCategory.type,
        query: newCategory.query,
      });
      setNewCategory({
        name: '',
        type: 'movie',
        query: '',
        disabled: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newCategory);
    });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === active.id,
    );
    const newIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === over.id,
    );
    setCategories((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = categories.map((c) => `${c.query}:${c.type}`);
    withLoading('saveCategoryOrder', () =>
      callCategoryApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const renderRow = (category: CustomCategory) => (
    <SortableTableRow
      key={`${category.query}:${category.type}`}
      id={`${category.query}:${category.type}`}
    >
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
        {category.name || '-'}
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
        <span
          className={`px-2 py-1 text-xs rounded-full ${
            category.type === 'movie'
              ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
              : 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
          }`}
        >
          {category.type === 'movie' ? '电影' : '电视剧'}
        </span>
      </td>
      <td
        className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
        title={category.query}
      >
        {category.query}
      </td>
      <td className='px-6 py-4 whitespace-nowrap max-w-4'>
        <span
          className={`px-2 py-1 text-xs rounded-full ${
            !category.disabled
              ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
              : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
          }`}
        >
          {!category.disabled ? '启用中' : '已禁用'}
        </span>
      </td>
      <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
        <button
          onClick={() => handleToggleEnable(category.query, category.type)}
          disabled={isLoading(
            `toggleCategory_${category.query}_${category.type}`,
          )}
          className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
            !category.disabled
              ? buttonStyles.roundedDanger
              : buttonStyles.roundedSuccess
          } transition-colors ${
            isLoading(`toggleCategory_${category.query}_${category.type}`)
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
        >
          {!category.disabled ? '禁用' : '启用'}
        </button>
        {category.from !== 'config' && (
          <button
            onClick={() => handleDelete(category.query, category.type)}
            disabled={isLoading(
              `deleteCategory_${category.query}_${category.type}`,
            )}
            className={`${buttonStyles.roundedSecondary} ${
              isLoading(`deleteCategory_${category.query}_${category.type}`)
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            删除
          </button>
        )}
      </td>
    </SortableTableRow>
  );

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加分类表单 */}
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          自定义分类列表
        </h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={`px-3 py-1 text-sm rounded-lg transition-colors ${
            showAddForm ? buttonStyles.secondary : buttonStyles.success
          }`}
        >
          {showAddForm ? '取消' : '添加分类'}
        </button>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='分类名称'
              value={newCategory.name}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <select
              value={newCategory.type}
              onChange={(e) =>
                setNewCategory((prev) => ({
                  ...prev,
                  type: e.target.value as 'movie' | 'tv',
                }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            >
              <option value='movie'>电影</option>
              <option value='tv'>电视剧</option>
            </select>
            <input
              type='text'
              placeholder='搜索关键词'
              value={newCategory.query}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, query: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddCategory}
              disabled={
                !newCategory.name ||
                !newCategory.query ||
                isLoading('addCategory')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newCategory.name ||
                !newCategory.query ||
                isLoading('addCategory')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addCategory') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* 分类表格 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-8' />
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  分类名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  类型
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  搜索关键词
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={categories.map((c) => `${c.query}:${c.type}`)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {categories.map(renderRow)}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveCategoryOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveCategoryOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveCategoryOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 新增配置文件组件
export const ConfigFileComponent = ({
  config,
  refreshConfig,
  storageMode,
  updateConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  storageMode: 'cloud' | 'local';
  updateConfig: (
    updater: (prev: AdminConfig | null) => AdminConfig | null,
  ) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [configContent, setConfigContent] = useState('');
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<string>('');

  useEffect(() => {
    if (config?.ConfigFile) {
      setConfigContent(config.ConfigFile);
    }
    if (config?.ConfigSubscribtion) {
      setSubscriptionUrl(config.ConfigSubscribtion.URL);
      setAutoUpdate(config.ConfigSubscribtion.AutoUpdate);
      setLastCheckTime(config.ConfigSubscribtion.LastCheck || '');
    }
  }, [config]);

  // 拉取订阅配置
  const handleFetchConfig = async () => {
    if (!subscriptionUrl.trim()) {
      showError('请输入订阅URL', showAlert);
      return;
    }

    await withLoading('fetchConfig', async () => {
      try {
        const resp = await fetch('/api/admin/config_subscription/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: subscriptionUrl }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `拉取失败: ${resp.status}`);
        }

        const data = await resp.json();
        if (data.configContent) {
          setConfigContent(data.configContent);
          // 更新本地配置的最后检查时间
          const currentTime = new Date().toISOString();
          setLastCheckTime(currentTime);
          showSuccess('配置拉取成功', showAlert);
        } else {
          showError('拉取失败：未获取到配置内容', showAlert);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : '拉取失败', showAlert);
        throw err;
      }
    });
  };

  // 本地模式：解析配置文件并更新源配置
  const parseAndApplyConfigFile = (configFileContent: string) => {
    interface ConfigFileStruct {
      api_site?: {
        [key: string]: {
          key?: string;
          api: string;
          name: string;
          detail?: string;
          is_adult?: boolean;
        };
      };
      custom_category?: {
        name?: string;
        type: 'movie' | 'tv';
        query: string;
      }[];
      lives?: {
        [key: string]: {
          name: string;
          url: string;
          ua?: string;
          epg?: string;
          sortOrder?: number;
        };
      };
    }

    let parsed: ConfigFileStruct = {};
    try {
      if (configFileContent && configFileContent.trim()) {
        parsed = JSON.parse(configFileContent);
      }
    } catch {
      // 解析失败时使用空对象
    }

    updateConfig((prev) => {
      if (!prev) return prev;

      // 保留自定义源（from !== 'config'）
      const customSources = (prev.SourceConfig || []).filter(
        (s) => s.from !== 'config',
      );
      const customCategories = (prev.CustomCategories || []).filter(
        (c) => c.from !== 'config',
      );
      const customLives = (prev.LiveConfig || []).filter(
        (l) => l.from !== 'config',
      );

      // 从配置文件解析新的预设源
      const configSources = Object.entries(parsed.api_site || {}).map(
        ([key, site]) => ({
          key,
          name: site.name,
          api: site.api,
          detail: site.detail,
          is_adult: site.is_adult || false,
          from: 'config' as const,
          disabled: false,
        }),
      );

      const configCategories = (parsed.custom_category || []).map((cat) => ({
        name: cat.name || cat.query,
        type: cat.type,
        query: cat.query,
        from: 'config' as const,
        disabled: false,
      }));

      const configLives = Object.entries(parsed.lives || {}).map(
        ([key, live]) => ({
          key,
          name: live.name,
          url: live.url,
          ua: live.ua,
          epg: live.epg,
          sortOrder: getLiveSourceSortOrder({
            sortOrder:
              prev.LiveConfig?.find((source) => source.key === key)
                ?.sortOrder ?? live.sortOrder,
          }),
          channelNumber: 0,
          from: 'config' as const,
          disabled: false,
        }),
      );

      return {
        ...prev,
        ConfigFile: configFileContent,
        ConfigSubscribtion: {
          URL: subscriptionUrl,
          AutoUpdate: autoUpdate,
          LastCheck: lastCheckTime || new Date().toISOString(),
        },
        SourceConfig: [...configSources, ...customSources],
        CustomCategories: [...configCategories, ...customCategories],
        LiveConfig: [...configLives, ...customLives],
      };
    });
  };

  // 保存配置文件
  const handleSave = async () => {
    // 检查是否要清空配置
    const isEmpty = !configContent || !configContent.trim();

    if (isEmpty) {
      // 统计将被删除的系统预设源数量
      const configSources =
        config?.SourceConfig?.filter((s) => s.from === 'config') || [];

      if (configSources.length > 0) {
        // 需要用户确认清空操作
        const confirmed = confirm(
          `⚠️ 清空配置文件警告\n\n` +
            `你正在清空配置文件，这将会：\n` +
            `• 删除 ${configSources.length} 个系统预设视频源\n` +
            `• 保留所有自定义添加的视频源\n\n` +
            `确定要继续吗？`,
        );

        if (!confirmed) {
          return;
        }
      }
    }

    await withLoading('saveConfig', async () => {
      // 本地模式：直接解析并更新配置
      if (storageMode === 'local') {
        parseAndApplyConfigFile(configContent);
        if (
          isEmpty &&
          (config?.SourceConfig?.filter((s) => s.from === 'config').length ??
            0) > 0
        ) {
          showSuccess(
            '配置文件已清空，系统预设视频源已删除，自定义源已保留',
            showAlert,
          );
        } else {
          showSuccess('配置文件保存成功', showAlert);
        }
        return;
      }

      // 云端模式：调用 API
      try {
        const resp = await fetch('/api/admin/config_file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            configFile: configContent,
            subscriptionUrl,
            autoUpdate,
            lastCheckTime: lastCheckTime || new Date().toISOString(),
          }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `保存失败: ${resp.status}`);
        }

        if (
          isEmpty &&
          (config?.SourceConfig?.filter((s) => s.from === 'config').length ??
            0) > 0
        ) {
          showSuccess(
            '配置文件已清空，系统预设视频源已删除，自定义源已保留',
            showAlert,
          );
        } else {
          showSuccess('配置文件保存成功', showAlert);
        }

        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* 配置订阅区域 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 shadow-sm'>
        <div className='flex items-center justify-between mb-6'>
          <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            配置订阅
          </h3>
          <div className='text-sm text-gray-500 dark:text-gray-400 px-3 py-1.5 rounded-full'>
            最后更新:{' '}
            {lastCheckTime
              ? new Date(lastCheckTime).toLocaleString('zh-CN')
              : '从未更新'}
          </div>
        </div>

        <div className='space-y-6'>
          {/* 订阅URL输入 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
              订阅URL
            </label>
            <input
              type='url'
              value={subscriptionUrl}
              onChange={(e) => setSubscriptionUrl(e.target.value)}
              placeholder='https://example.com/config.json'
              disabled={false}
              className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
            />
            <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
              输入配置文件的订阅地址，要求 JSON 格式，且使用 Base58 编码
            </p>
          </div>

          {/* 拉取配置按钮 */}
          <div className='pt-2'>
            <button
              onClick={handleFetchConfig}
              disabled={isLoading('fetchConfig') || !subscriptionUrl.trim()}
              className={`w-full px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                isLoading('fetchConfig') || !subscriptionUrl.trim()
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('fetchConfig') ? (
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                  拉取中…
                </div>
              ) : (
                '拉取配置'
              )}
            </button>
          </div>

          {/* 自动更新开关 */}
          <div className='flex items-center justify-between'>
            <div>
              <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                自动更新
              </label>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                启用后系统将定期自动拉取最新配置
              </p>
            </div>
            <button
              type='button'
              onClick={() => setAutoUpdate(!autoUpdate)}
              disabled={false}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                autoUpdate ? buttonStyles.toggleOn : buttonStyles.toggleOff
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full ${
                  buttonStyles.toggleThumb
                } transition-transform ${
                  autoUpdate
                    ? buttonStyles.toggleThumbOn
                    : buttonStyles.toggleThumbOff
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 配置文件编辑区域 */}
      <div className='space-y-4'>
        <div className='relative'>
          <textarea
            value={configContent}
            onChange={(e) => setConfigContent(e.target.value)}
            rows={20}
            placeholder='请输入配置文件内容（JSON 格式）...'
            disabled={false}
            className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500'
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
            }}
            spellCheck={false}
            data-gramm={false}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div className='text-xs text-gray-500 dark:text-gray-400'>
            支持 JSON 格式，用于配置视频源和自定义分类
          </div>
          <button
            onClick={handleSave}
            disabled={isLoading('saveConfig')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              isLoading('saveConfig')
                ? buttonStyles.disabled
                : buttonStyles.success
            }`}
          >
            {isLoading('saveConfig') ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 新增站点配置组件
export const SiteConfigComponent = ({
  config,
  refreshConfig,
  canManageApkDownload,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  canManageApkDownload: boolean;
}) => {
  const router = useRouter();
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    ApkDownloadUrl: '',
    SiteName: '',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    DoubanProxyType: 'auto',
    DoubanProxy: '',
    DoubanImageProxyType: 'auto',
    DoubanImageProxy: '',
    TmdbApiKey: '',
    TmdbProxyType: 'direct',
    TmdbProxy: '',
    TmdbReverseProxy: '',
    DisableYellowFilter: false,
    FluidSearch: true,
    SearchResultLoadMode: 'infinite',
    LoginBackground: 'https://pan.yyds.nyc.mn/background.png',
  });

  // 广告过滤总开关（独立于 SiteConfig，立即保存到 /api/admin/adfilter）
  const [adFilterEnabled, setAdFilterEnabled] = useState(true);
  const [adFilterSaving, setAdFilterSaving] = useState(false);

  // 豆瓣数据源相关状态
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);
  const [doubanDataTestResult, setDoubanDataTestResult] = useState('');
  const [doubanImageTestResult, setDoubanImageTestResult] = useState('');

  // 豆瓣数据源选项
  const doubanDataSourceOptions = [
    { value: 'auto', label: '智能自动（推荐）' },
    { value: 'direct', label: '直连（服务器直接请求豆瓣）' },
    { value: 'server', label: '服务器代理' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];

  // 豆瓣图片代理选项
  const doubanImageProxyTypeOptions = [
    { value: 'auto', label: '智能自动（推荐）' },
    { value: 'direct', label: '直连（浏览器直接请求豆瓣）' },
    { value: 'server', label: '服务器代理（由服务器代理请求豆瓣）' },
    { value: 'img3', label: '豆瓣官方精品 CDN（阿里云）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];

  // 获取感谢信息
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        ApkDownloadUrl: config.SiteConfig.ApkDownloadUrl || '',
        DoubanProxyType: config.SiteConfig.DoubanProxyType || 'auto',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
        DoubanImageProxyType: config.SiteConfig.DoubanImageProxyType || 'auto',
        DoubanImageProxy: config.SiteConfig.DoubanImageProxy || '',
        TmdbApiKey: config.TMDBConfig?.ApiKey || '',
        TmdbProxyType: config.SiteConfig.TmdbProxyType || 'direct',
        TmdbProxy: config.SiteConfig.TmdbProxy || '',
        TmdbReverseProxy: config.SiteConfig.TmdbReverseProxy || '',
        DisableYellowFilter: config.SiteConfig.DisableYellowFilter || false,
        FluidSearch: config.SiteConfig.FluidSearch ?? true,
        SearchResultLoadMode:
          config.SiteConfig.SearchResultLoadMode === 'pagination'
            ? 'pagination'
            : 'infinite',
        LoginBackground:
          config.SiteConfig.LoginBackground ||
          'https://pan.yyds.nyc.mn/background.png',
      });
    }
    if (config?.AdFilterConfig) {
      setAdFilterEnabled(config.AdFilterConfig.enabled ?? true);
    }
  }, [config]);

  // 切换广告过滤总开关，立即调用 /api/admin/adfilter 保存
  const handleToggleAdFilterGlobal = async () => {
    if (adFilterSaving) return;
    const next = !adFilterEnabled;
    setAdFilterEnabled(next); // 乐观更新
    setAdFilterSaving(true);
    try {
      const resp = await fetch('/api/admin/adfilter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!resp.ok) {
        setAdFilterEnabled(!next); // 失败回滚
        const err = await resp.json().catch(() => null);
        showError(err?.error || '保存广告过滤开关失败');
      }
    } catch (e) {
      setAdFilterEnabled(!next);
      showError(e instanceof Error ? e.message : '保存广告过滤开关失败');
    } finally {
      setAdFilterSaving(false);
    }
  };

  // 点击外部区域关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  // 处理豆瓣数据源变化
  const handleDoubanDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanProxyType: value,
    }));
  };

  // 处理豆瓣图片代理变化
  const handleDoubanImageProxyChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanImageProxyType: value,
    }));
  };

  const handleTestDoubanProxy = async (target: 'data' | 'image') => {
    const params = new URLSearchParams({
      target,
      proxyType:
        target === 'data'
          ? siteSettings.DoubanProxyType
          : siteSettings.DoubanImageProxyType,
      proxyUrl:
        target === 'data'
          ? siteSettings.DoubanProxy
          : siteSettings.DoubanImageProxy,
    });
    const loadingKey = target === 'data' ? 'testDoubanData' : 'testDoubanImage';

    await withLoading(loadingKey, async () => {
      const resp = await fetch(`/api/douban/health?${params.toString()}`, {
        cache: 'no-store',
      });
      const result = await resp.json().catch(() => ({}));
      const attempts = Array.isArray(result.attempts) ? result.attempts : [];
      const firstFailure = attempts.find((item: any) => !item.ok);
      const message = result.ok
        ? `成功：${result.provider}，${Math.round(result.durationMs || 0)}ms`
        : `失败：${firstFailure?.reason || result.error || '未知错误'}`;

      if (target === 'data') {
        setDoubanDataTestResult(message);
      } else {
        setDoubanImageTestResult(message);
      }

      if (!resp.ok || !result.ok) {
        throw new Error(message);
      }

      showSuccess(message, showAlert);
    }).catch((err) => {
      showError(
        err instanceof Error ? err.message : '豆瓣代理检测失败',
        showAlert,
      );
    });
  };

  // 保存站点配置
  const handleSave = async () => {
    const apkDownloadUrl = normalizeApkDownloadUrl(siteSettings.ApkDownloadUrl);
    if (apkDownloadUrl === null) {
      showError(
        'APK 下载页地址必须是完整的 HTTP 或 HTTPS 链接，留空可关闭入口',
        showAlert,
      );
      return;
    }
    await withLoading('saveSiteConfig', async () => {
      try {
        const resp = await fetch('/api/admin/site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...siteSettings,
            ApkDownloadUrl: apkDownloadUrl,
          }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `保存失败: ${resp.status}`);
        }

        showSuccess('保存成功, 请刷新页面', showAlert);
        window.dispatchEvent(new CustomEvent('doubanProxyChanged'));
        await refreshConfig();
        router.refresh();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站点名称 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点名称
        </label>
        <input
          type='text'
          value={siteSettings.SiteName}
          onChange={(e) =>
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 安卓客户端下载 */}
      <div>
        <label
          htmlFor='site-apk-download-url'
          className='mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300'
        >
          APK 下载页地址
        </label>
        <input
          id='site-apk-download-url'
          type='url'
          value={siteSettings.ApkDownloadUrl}
          onChange={(event) =>
            setSiteSettings((previous) => ({
              ...previous,
              ApkDownloadUrl: event.target.value,
            }))
          }
          disabled={!canManageApkDownload}
          maxLength={2048}
          placeholder='输入完整的下载页链接，留空隐藏入口'
          aria-describedby='site-apk-download-help'
          className='w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 focus:border-transparent focus:ring-2 focus:ring-green-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100'
        />
        <p
          id='site-apk-download-help'
          className='mt-2 text-xs text-gray-500 dark:text-gray-400'
        >
          仅站长可修改。保存后用于登录页、注册页和站内右上角的下载按钮、复制链接及二维码；留空关闭入口。
        </p>
      </div>
      {/* 站点公告 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点公告
        </label>
        <textarea
          value={siteSettings.Announcement}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          rows={3}
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 豆瓣数据源设置 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            豆瓣数据代理
          </label>
          <div className='relative' data-dropdown='douban-datasource'>
            {/* 自定义下拉选择框 */}
            <button
              type='button'
              onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
              className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
            >
              {
                doubanDataSourceOptions.find(
                  (option) => option.value === siteSettings.DoubanProxyType,
                )?.label
              }
            </button>

            {/* 下拉箭头 */}
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                  isDoubanDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {/* 下拉选项列表 */}
            {isDoubanDropdownOpen && (
              <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                {doubanDataSourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      handleDoubanDataSourceChange(option.value);
                      setIsDoubanDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      siteSettings.DoubanProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            选择获取豆瓣数据的方式
          </p>
          <div className='mt-2 flex items-center gap-2'>
            <button
              type='button'
              onClick={() => handleTestDoubanProxy('data')}
              disabled={isLoading('testDoubanData')}
              className='inline-flex items-center px-3 py-1.5 rounded-lg text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60'
            >
              {isLoading('testDoubanData') ? '检测中...' : '检测数据代理'}
            </button>
            {doubanDataTestResult && (
              <span className='text-xs text-gray-500 dark:text-gray-400'>
                {doubanDataTestResult}
              </span>
            )}
          </div>

          {/* 感谢信息 */}
          {getThanksInfo(siteSettings.DoubanProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanProxyType)!.url,
                    '_blank',
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
        {siteSettings.DoubanProxyType === 'custom' && (
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              豆瓣代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              自定义代理服务器地址
            </p>
          </div>
        )}
      </div>

      {/* 豆瓣图片代理设置 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            豆瓣图片代理
          </label>
          <div className='relative' data-dropdown='douban-image-proxy'>
            {/* 自定义下拉选择框 */}
            <button
              type='button'
              onClick={() =>
                setIsDoubanImageProxyDropdownOpen(
                  !isDoubanImageProxyDropdownOpen,
                )
              }
              className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
            >
              {
                doubanImageProxyTypeOptions.find(
                  (option) =>
                    option.value === siteSettings.DoubanImageProxyType,
                )?.label
              }
            </button>

            {/* 下拉箭头 */}
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                  isDoubanImageProxyDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {/* 下拉选项列表 */}
            {isDoubanImageProxyDropdownOpen && (
              <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                {doubanImageProxyTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      handleDoubanImageProxyChange(option.value);
                      setIsDoubanImageProxyDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      siteSettings.DoubanImageProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanImageProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            选择获取豆瓣图片的方式
          </p>
          <div className='mt-2 flex items-center gap-2'>
            <button
              type='button'
              onClick={() => handleTestDoubanProxy('image')}
              disabled={isLoading('testDoubanImage')}
              className='inline-flex items-center px-3 py-1.5 rounded-lg text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60'
            >
              {isLoading('testDoubanImage') ? '检测中...' : '检测图片代理'}
            </button>
            {doubanImageTestResult && (
              <span className='text-xs text-gray-500 dark:text-gray-400'>
                {doubanImageTestResult}
              </span>
            )}
          </div>

          {/* 感谢信息 */}
          {getThanksInfo(siteSettings.DoubanImageProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanImageProxyType)!.url,
                    '_blank',
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanImageProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
        {siteSettings.DoubanImageProxyType === 'custom' && (
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              豆瓣图片代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanImageProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanImageProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              自定义图片代理服务器地址
            </p>
          </div>
        )}
      </div>

      {/* TMDB 代理设置 */}
      <div className='space-y-3 p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            TMDB API Key
          </label>
          <input
            type='password'
            placeholder='输入 TMDB v3 API Key'
            value={siteSettings.TmdbApiKey}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                TmdbApiKey: e.target.value,
              }))
            }
            className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          />
        </div>

        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            TMDB 代理模式
          </label>
          <select
            value={siteSettings.TmdbProxyType}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                TmdbProxyType: e.target.value as
                  | 'direct'
                  | 'forward'
                  | 'reverse',
              }))
            }
            className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
          >
            <option value='direct'>直连</option>
            <option value='forward'>正向代理</option>
            <option value='reverse'>反向代理</option>
          </select>
        </div>

        {siteSettings.TmdbProxyType === 'forward' && (
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              TMDB 正向代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.TmdbProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  TmdbProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
        )}

        {siteSettings.TmdbProxyType === 'reverse' && (
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              TMDB 反向代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://tmdb.your-domain.com'
              value={siteSettings.TmdbReverseProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  TmdbReverseProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
        )}

        <button
          type='button'
          onClick={() =>
            withLoading('testTmdb', async () => {
              const resp = await fetch('/api/admin/tmdb/test', {
                cache: 'no-store',
              });
              const data = await resp.json().catch(() => ({}));
              if (!resp.ok) {
                throw new Error(data.error || 'TMDB 连通性测试失败');
              }
              showSuccess('TMDB 连通性测试通过', showAlert);
            }).catch((err) => {
              showError(
                err instanceof Error ? err.message : 'TMDB 连通性测试失败',
                showAlert,
              );
            })
          }
          disabled={isLoading('testTmdb')}
          className='inline-flex items-center px-3 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60'
        >
          {isLoading('testTmdb') ? '测试中...' : '测试 TMDB 连通性'}
        </button>
      </div>

      {/* 搜索接口可拉取最大页数 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          搜索接口可拉取最大页数
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SearchDownstreamMaxPage}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SearchDownstreamMaxPage: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站点接口缓存时间 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点接口缓存时间（秒）
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 成人内容过滤 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            启用成人内容过滤
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                DisableYellowFilter: !prev.DisableYellowFilter,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              !siteSettings.DisableYellowFilter
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                !siteSettings.DisableYellowFilter
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          开启后将过滤标记为成人资源的视频源和包含敏感关键词的内容。关闭后，还需要用户填写有效访问秘钥（或在「独立后台
          → 访问秘钥」启用空秘钥）才会显示。
        </p>
      </div>

      {/* 流式搜索 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            启用流式搜索
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                FluidSearch: !prev.FluidSearch,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.FluidSearch
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                siteSettings.FluidSearch
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          启用后搜索结果将实时流式返回，提升用户体验。
        </p>
      </div>

      {/* 搜索结果加载方式 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          搜索结果加载方式
        </label>
        <div className='inline-flex rounded-lg border border-gray-300 bg-white p-1 dark:border-gray-600 dark:bg-gray-800'>
          {[
            { value: 'infinite' as const, label: '触底加载' },
            { value: 'pagination' as const, label: '分页显示' },
          ].map((option) => (
            <button
              key={option.value}
              type='button'
              onClick={() =>
                setSiteSettings((prev) => ({
                  ...prev,
                  SearchResultLoadMode: option.value,
                }))
              }
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                siteSettings.SearchResultLoadMode === option.value
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          触底加载会随着下滑继续追加结果；分页显示则通过上一页/下一页切换。
        </p>
      </div>

      {/* 广告过滤总开关（独立于其他 SiteConfig，立即保存） */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            启用 m3u8 广告过滤
          </label>
          <button
            type='button'
            onClick={handleToggleAdFilterGlobal}
            disabled={adFilterSaving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              adFilterEnabled ? buttonStyles.toggleOn : buttonStyles.toggleOff
            } ${adFilterSaving ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                adFilterEnabled
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          自动识别并删除 CMS 资源站 m3u8 中由 #EXT-X-DISCONTINUITY
          拼接的广告分段。
          关掉后所有源直连上游，不再走过滤代理。可在视频源列表里对单个源单独豁免。
        </p>
      </div>

      {/* 登录页面背景图设置 */}
      <div className='space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700'>
        <div className='flex items-center gap-2'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            🖼️ 登录页面背景设置
          </h4>
        </div>
        <p className='text-xs text-gray-500 dark:text-gray-400 -mt-2'>
          设置登录页面的背景图片。支持本地图片路径（如
          /background.png）或外部图片直链。留空则使用默认动态背景。
        </p>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            背景图片地址
          </label>
          <input
            type='text'
            placeholder='例如: /background.png 或 https://example.com/bg.jpg'
            value={siteSettings.LoginBackground}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                LoginBackground: e.target.value,
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
          />
        </div>
        {/* 背景图预览 */}
        {siteSettings.LoginBackground && (
          <div className='mt-3'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              背景预览
            </label>
            <div className='relative w-full h-32 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600'>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={siteSettings.LoginBackground}
                alt='背景预览'
                className='w-full h-full object-cover'
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className='absolute inset-0 bg-black/30 flex items-center justify-center'>
                <span className='text-white text-sm font-medium px-3 py-1 bg-black/50 rounded-lg'>
                  登录背景预览
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveSiteConfig')}
          className={`px-4 py-2 ${
            isLoading('saveSiteConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          } rounded-lg transition-colors`}
        >
          {isLoading('saveSiteConfig') ? '保存中…' : '保存'}
        </button>
      </div>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 弹幕配置组件
interface DanmuConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

interface DanmuNodeFormState {
  name: string;
  url: string;
  token: string;
}

interface DanmuNodeHealthState {
  status: 'idle' | 'testing' | 'ok' | 'error';
  latency?: number;
  error?: string;
}

interface DanmuSettingsState {
  enabled: boolean;
  serverUrl: string;
  token: string;
  platform: string;
  sourceOrder: string;
  mergeSourcePairs: string;
  bilibiliCookie: string;
  convertTopBottomToScroll: boolean;
  convertColor: 'default' | 'white' | 'color';
  danmuLimit: number;
  blockedWords: string;
  danmuOutputFormat: 'json' | 'xml';
  simplifiedTraditional: 'default' | 'simplified' | 'traditional';
  customNodes: DanmuCustomNode[];
}

const DANMU_CUSTOM_NODE_STORAGE_KEY = 'decotv:danmu:custom-nodes';
const MAX_CUSTOM_DANMU_NODE_COUNT = 64;

const RECOMMENDED_DANMU_SERVER = {
  name: '官方推荐/稳定节点',
  url: 'https://danmu.katelya.eu.org',
  token: 'decotv',
  badge: '官方推荐',
};

const DEPLOYMENT_GUIDE_URL = 'https://github.com/huangxd-/danmu_api';

const DEMO_DANMU_SERVERS = [RECOMMENDED_DANMU_SERVER];

const SOURCE_OPTIONS = [
  { value: '360', label: '360搜索' },
  { value: 'vod', label: 'VOD采集' },
  { value: 'tmdb', label: 'TMDB' },
  { value: 'douban', label: '豆瓣' },
  { value: 'tencent', label: '腾讯视频' },
  { value: 'youku', label: '优酷' },
  { value: 'iqiyi', label: '爱奇艺' },
  { value: 'imgo', label: '芒果TV' },
  { value: 'bilibili', label: '哔哩哔哩' },
  { value: 'migu', label: '咪咕视频' },
  { value: 'sohu', label: '搜狐视频' },
  { value: 'leshi', label: '乐视' },
  { value: 'xigua', label: '西瓜视频' },
  { value: 'renren', label: '人人视频' },
  { value: 'hanjutv', label: '韩剧TV' },
  { value: 'bahamut', label: '巴哈姆特' },
  { value: 'dandan', label: '弹弹play' },
  { value: 'animeko', label: 'Animeko' },
  { value: 'custom', label: '自定义源' },
];

const PLATFORM_OPTIONS = [
  { value: 'qiyi', label: '爱奇艺' },
  { value: 'bilibili1', label: '哔哩哔哩' },
  { value: 'imgo', label: '芒果TV' },
  { value: 'youku', label: '优酷' },
  { value: 'qq', label: '腾讯视频' },
  { value: 'migu', label: '咪咕' },
  { value: 'sohu', label: '搜狐' },
  { value: 'leshi', label: '乐视' },
  { value: 'xigua', label: '西瓜' },
  { value: 'renren', label: '人人' },
  { value: 'hanjutv', label: '韩剧TV' },
  { value: 'bahamut', label: '巴哈姆特' },
  { value: 'dandan', label: '弹弹play' },
  { value: 'animeko', label: 'Animeko' },
  { value: 'custom', label: '自定义' },
];

export const DanmuConfigComponent = ({
  config,
  refreshConfig,
}: DanmuConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();

  const [danmuSettings, setDanmuSettings] = useState<DanmuSettingsState>({
    enabled: false,
    serverUrl: RECOMMENDED_DANMU_SERVER.url,
    token: RECOMMENDED_DANMU_SERVER.token,
    platform: '',
    sourceOrder: '',
    mergeSourcePairs: '',
    bilibiliCookie: '',
    convertTopBottomToScroll: false,
    convertColor: 'default' as 'default' | 'white' | 'color',
    danmuLimit: 0,
    blockedWords: '',
    danmuOutputFormat: 'json' as 'json' | 'xml',
    simplifiedTraditional: 'default' as
      | 'default'
      | 'simplified'
      | 'traditional',
    customNodes: [],
  });

  const [testResult, setTestResult] = useState<{
    success?: boolean;
    latency?: number;
    searchAvailable?: boolean;
    searchResultCount?: number;
    error?: string;
  } | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeForm, setNodeForm] = useState<DanmuNodeFormState>({
    name: '',
    url: '',
    token: '',
  });
  const [nodeHealthMap, setNodeHealthMap] = useState<
    Record<string, DanmuNodeHealthState>
  >({});

  const normalizeServerUrl = useCallback((value: string) => {
    return value.trim().replace(/\/+$/, '');
  }, []);

  const createNodeId = useCallback(() => {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
    return `node_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }, []);

  // 统一过滤与规范化节点数据，避免脏数据写入配置。
  const sanitizeCustomNodes = useCallback(
    (value: unknown): DanmuCustomNode[] => {
      if (!Array.isArray(value)) {
        return [];
      }

      const now = Date.now();
      const nodes: DanmuCustomNode[] = [];
      for (const item of value) {
        if (!item || typeof item !== 'object') {
          continue;
        }

        const raw = item as Partial<DanmuCustomNode>;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        const url =
          typeof raw.url === 'string' ? normalizeServerUrl(raw.url) : '';
        if (!name || !url) {
          continue;
        }

        const token = typeof raw.token === 'string' ? raw.token.trim() : '';
        const createdAt =
          typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
            ? raw.createdAt
            : now;
        const updatedAt =
          typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
            ? raw.updatedAt
            : now;
        const id =
          typeof raw.id === 'string' && raw.id.trim()
            ? raw.id.trim()
            : `node_${createdAt}_${nodes.length}`;

        nodes.push({ id, name, url, token, createdAt, updatedAt });
        if (nodes.length >= MAX_CUSTOM_DANMU_NODE_COUNT) {
          break;
        }
      }

      return nodes;
    },
    [normalizeServerUrl],
  );

  const loadCustomNodesFromStorage = useCallback((): DanmuCustomNode[] => {
    if (typeof window === 'undefined') {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(DANMU_CUSTOM_NODE_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      return sanitizeCustomNodes(JSON.parse(raw));
    } catch {
      return [];
    }
  }, [sanitizeCustomNodes]);

  const persistCustomNodesToStorage = useCallback(
    (nodes: DanmuCustomNode[]) => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(
          DANMU_CUSTOM_NODE_STORAGE_KEY,
          JSON.stringify(nodes),
        );
      } catch {
        // localStorage 异常不影响主流程。
      }
    },
    [],
  );

  useEffect(() => {
    if (config?.DanmuConfig) {
      const configCustomNodes = sanitizeCustomNodes(
        config.DanmuConfig.customNodes,
      );
      const customNodes =
        configCustomNodes.length > 0
          ? configCustomNodes
          : loadCustomNodesFromStorage();
      setDanmuSettings({
        enabled: config.DanmuConfig.enabled ?? false,
        serverUrl: normalizeServerUrl(config.DanmuConfig.serverUrl ?? ''),
        token: config.DanmuConfig.token ?? '',
        platform: config.DanmuConfig.platform ?? '',
        sourceOrder: config.DanmuConfig.sourceOrder ?? '',
        mergeSourcePairs: config.DanmuConfig.mergeSourcePairs ?? '',
        bilibiliCookie: config.DanmuConfig.bilibiliCookie ?? '',
        convertTopBottomToScroll:
          config.DanmuConfig.convertTopBottomToScroll ?? false,
        convertColor: config.DanmuConfig.convertColor ?? 'default',
        danmuLimit: config.DanmuConfig.danmuLimit ?? 0,
        blockedWords: config.DanmuConfig.blockedWords ?? '',
        danmuOutputFormat: config.DanmuConfig.danmuOutputFormat ?? 'json',
        simplifiedTraditional:
          config.DanmuConfig.simplifiedTraditional ?? 'default',
        customNodes,
      });
      return;
    }
    const fallbackNodes = loadCustomNodesFromStorage();
    if (fallbackNodes.length > 0) {
      setDanmuSettings((prev) => ({
        ...prev,
        customNodes: fallbackNodes,
      }));
    }
  }, [
    config,
    loadCustomNodesFromStorage,
    normalizeServerUrl,
    sanitizeCustomNodes,
  ]);

  useEffect(() => {
    persistCustomNodesToStorage(danmuSettings.customNodes);
  }, [danmuSettings.customNodes, persistCustomNodesToStorage]);

  // 构建实际 API 地址（baseUrl + token 拼接）
  const getFullServerUrl = (
    serverUrl = danmuSettings.serverUrl,
    token = danmuSettings.token,
  ) => {
    const base = normalizeServerUrl(serverUrl);
    if (!base) return '';
    const safeToken = token.trim();
    if (safeToken) {
      return `${base}/${safeToken}`;
    }
    return base;
  };

  const persistDanmuSettings = useCallback(
    async (nextSettings: DanmuSettingsState, successMessage: string) => {
      const resp = await fetch('/api/admin/danmu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || '保存失败');
      }
      persistCustomNodesToStorage(nextSettings.customNodes);
      await refreshConfig();
      setDanmuSettings(nextSettings);
      showSuccess(successMessage, showAlert);
    },
    [persistCustomNodesToStorage, refreshConfig, showAlert],
  );

  const handleSave = async () => {
    await withLoading('saveDanmuConfig', async () => {
      try {
        await persistDanmuSettings(danmuSettings, '弹幕配置保存成功');
      } catch (err) {
        showError(`保存弹幕配置失败: ${(err as Error).message}`, showAlert);
      }
    });
  };

  const handleTest = async () => {
    const url = getFullServerUrl();
    if (!url) {
      showError('请先填写弹幕服务器地址', showAlert);
      return;
    }
    setTestResult(null);
    await withLoading('testDanmuServer', async () => {
      try {
        const resp = await fetch('/api/admin/danmu/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl: url }),
        });
        const data = await resp.json();
        setTestResult(data);
      } catch (err) {
        setTestResult({
          success: false,
          error: (err as Error).message,
        });
      }
    });
  };

  const handleSelectDemoServer = (server: { url: string; token?: string }) => {
    setDanmuSettings((prev) => ({
      ...prev,
      serverUrl: normalizeServerUrl(server.url),
      token: server.token ?? prev.token,
    }));
    setTestResult(null);
  };

  const isNodeSelected = (node: DanmuCustomNode) => {
    return (
      normalizeServerUrl(danmuSettings.serverUrl) ===
        normalizeServerUrl(node.url) &&
      danmuSettings.token.trim() === node.token.trim()
    );
  };

  const openAddNodeModal = () => {
    setEditingNodeId(null);
    setNodeForm({ name: '', url: '', token: '' });
    setIsNodeModalOpen(true);
  };

  const openEditNodeModal = (node: DanmuCustomNode) => {
    setEditingNodeId(node.id);
    setNodeForm({
      name: node.name,
      url: node.url,
      token: node.token,
    });
    setIsNodeModalOpen(true);
  };

  const closeNodeModal = () => {
    setIsNodeModalOpen(false);
    setEditingNodeId(null);
    setNodeForm({ name: '', url: '', token: '' });
  };

  const handleSubmitNode = () => {
    const name = nodeForm.name.trim();
    const url = normalizeServerUrl(nodeForm.url);
    const token = nodeForm.token.trim();

    if (!name || !url) {
      showError('节点名称和服务地址不能为空', showAlert);
      return;
    }

    if (
      !editingNodeId &&
      danmuSettings.customNodes.length >= MAX_CUSTOM_DANMU_NODE_COUNT
    ) {
      showError(
        `最多仅支持 ${MAX_CUSTOM_DANMU_NODE_COUNT} 个自定义节点`,
        showAlert,
      );
      return;
    }

    const now = Date.now();
    setDanmuSettings((prev) => {
      if (editingNodeId) {
        return {
          ...prev,
          customNodes: prev.customNodes.map((item) =>
            item.id === editingNodeId
              ? { ...item, name, url, token, updatedAt: now }
              : item,
          ),
        };
      }

      const nextNode: DanmuCustomNode = {
        id: createNodeId(),
        name,
        url,
        token,
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...prev,
        customNodes: [nextNode, ...prev.customNodes],
      };
    });

    if (editingNodeId) {
      setNodeHealthMap((prev) => {
        const next = { ...prev };
        delete next[editingNodeId];
        return next;
      });
    }

    setTestResult(null);
    closeNodeModal();
    showSuccess(editingNodeId ? '节点更新成功' : '节点添加成功', showAlert);
  };

  const handleDeleteNode = (node: DanmuCustomNode) => {
    if (!window.confirm(`确认删除节点「${node.name}」吗？`)) {
      return;
    }

    setDanmuSettings((prev) => ({
      ...prev,
      customNodes: prev.customNodes.filter((item) => item.id !== node.id),
    }));
    setNodeHealthMap((prev) => {
      const next = { ...prev };
      delete next[node.id];
      return next;
    });
    showSuccess('节点已删除', showAlert);
  };

  const handleApplyNode = async (node: DanmuCustomNode) => {
    const nextSettings: DanmuSettingsState = {
      ...danmuSettings,
      enabled: true,
      serverUrl: node.url,
      token: node.token,
    };

    await withLoading(`applyDanmuNode_${node.id}`, async () => {
      try {
        await persistDanmuSettings(nextSettings, `已应用节点：${node.name}`);
        setTestResult(null);
      } catch (err) {
        showError(`应用节点失败: ${(err as Error).message}`, showAlert);
      }
    });
  };

  const handleTestNode = async (node: DanmuCustomNode) => {
    const fullUrl = getFullServerUrl(node.url, node.token);
    if (!fullUrl) {
      showError('节点地址不合法', showAlert);
      return;
    }

    setNodeHealthMap((prev) => ({
      ...prev,
      [node.id]: { status: 'testing' },
    }));

    await withLoading(`testDanmuNode_${node.id}`, async () => {
      try {
        const resp = await fetch('/api/admin/danmu/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl: fullUrl }),
        });
        const data = (await resp.json()) as {
          success?: boolean;
          latency?: number;
          error?: string;
        };

        if (data.success) {
          setNodeHealthMap((prev) => ({
            ...prev,
            [node.id]: {
              status: 'ok',
              latency:
                typeof data.latency === 'number' &&
                Number.isFinite(data.latency)
                  ? data.latency
                  : undefined,
            },
          }));
          return;
        }

        setNodeHealthMap((prev) => ({
          ...prev,
          [node.id]: {
            status: 'error',
            error: data.error || '连接失败',
          },
        }));
      } catch (err) {
        setNodeHealthMap((prev) => ({
          ...prev,
          [node.id]: {
            status: 'error',
            error: (err as Error).message || '连接失败',
          },
        }));
      }
    });
  };

  const toggleSourceOrder = (source: string) => {
    setDanmuSettings((prev) => {
      const current = prev.sourceOrder
        ? prev.sourceOrder
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const idx = current.indexOf(source);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(source);
      }
      return { ...prev, sourceOrder: current.join(',') };
    });
  };

  const togglePlatform = (platform: string) => {
    setDanmuSettings((prev) => {
      const current = prev.platform
        ? prev.platform
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const idx = current.indexOf(platform);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(platform);
      }
      return { ...prev, platform: current.join(',') };
    });
  };

  const selectedSources = danmuSettings.sourceOrder
    ? danmuSettings.sourceOrder
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const selectedPlatforms = danmuSettings.platform
    ? danmuSettings.platform
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const customNodes = danmuSettings.customNodes;

  const getNodeHealthView = (nodeId: string) => {
    const health = nodeHealthMap[nodeId];
    if (!health || health.status === 'idle') {
      return (
        <span className='inline-flex rounded-full bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300 px-2 py-0.5 text-[11px]'>
          未测试
        </span>
      );
    }
    if (health.status === 'testing') {
      return (
        <span className='inline-flex rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-[11px]'>
          测试中...
        </span>
      );
    }
    if (health.status === 'ok') {
      return (
        <span className='inline-flex rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px]'>
          {typeof health.latency === 'number' ? `${health.latency}ms` : '可用'}
        </span>
      );
    }
    return (
      <span
        className='inline-flex rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-0.5 text-[11px]'
        title={health.error || '连接失败'}
      >
        不可用
      </span>
    );
  };

  return (
    <div className='space-y-6'>
      {/* 顶部状态提示 */}
      <div
        className={`rounded-lg border p-4 ${
          danmuSettings.enabled
            ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
            : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
        }`}
      >
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                danmuSettings.enabled
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-gray-400'
              }`}
            />
            <div>
              <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                {danmuSettings.enabled
                  ? '自定义弹幕服务已启用'
                  : '弹弹play官方弹幕链路'}
              </p>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                {danmuSettings.enabled
                  ? danmuSettings.serverUrl
                    ? `服务器: ${getFullServerUrl()}`
                    : '请配置弹幕服务器地址'
                  : 'Vercel 可回退托管中继；Docker 需自有凭证或显式中继'}
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              setDanmuSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
            className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors ${
              danmuSettings.enabled
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
                buttonStyles.toggleThumb
              } ${
                danmuSettings.enabled
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
      </div>

      {/* 服务器配置区域 */}
      {danmuSettings.enabled && (
        <div className='space-y-6'>
          {/* 仅当使用内置演示站（或未配置自定义地址）时显示警告 */}
          {(!danmuSettings.serverUrl ||
            DEMO_DANMU_SERVERS.some(
              (s) =>
                normalizeServerUrl(s.url) ===
                normalizeServerUrl(danmuSettings.serverUrl),
            )) && (
            <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/15 p-4'>
              <div className='flex items-start gap-2'>
                <AlertTriangle className='w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5' />
                <div className='space-y-1'>
                  <p className='text-sm font-medium text-amber-900 dark:text-amber-200'>
                    内置演示站仅供测试，极其不稳定，强烈建议用户自行部署。
                  </p>
                  <p className='text-xs text-amber-700 dark:text-amber-300 flex flex-wrap items-center gap-1.5'>
                    自部署教程:
                    <a
                      href={DEPLOYMENT_GUIDE_URL}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-1 font-medium underline hover:text-amber-900 dark:hover:text-amber-100'
                    >
                      huangxd-/danmu_api
                      <ExternalLink className='w-3 h-3' />
                    </a>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 服务器地址 & Token */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-blue-500 rounded-full'></span>
                服务器连接
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                配置 LogVar 弹幕 API 服务器地址和访问令牌
              </p>
            </div>
            <div className='p-4 space-y-4'>
              {/* 服务器地址 */}
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  服务器地址
                </label>
                <div className='flex gap-2'>
                  <input
                    type='text'
                    value={danmuSettings.serverUrl}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        serverUrl: e.target.value,
                      }))
                    }
                    placeholder='如 http://192.168.1.7:9321 或 https://your-domain.com'
                    className='flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500'
                  />
                  <button
                    onClick={handleTest}
                    disabled={
                      isLoading('testDanmuServer') || !danmuSettings.serverUrl
                    }
                    className={`shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                      isLoading('testDanmuServer') || !danmuSettings.serverUrl
                        ? buttonStyles.disabled
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm hover:shadow-md'
                    }`}
                  >
                    {isLoading('testDanmuServer') ? (
                      <svg
                        className='w-4 h-4 animate-spin'
                        viewBox='0 0 24 24'
                        fill='none'
                      >
                        <circle
                          className='opacity-25'
                          cx='12'
                          cy='12'
                          r='10'
                          stroke='currentColor'
                          strokeWidth='4'
                        />
                        <path
                          className='opacity-75'
                          fill='currentColor'
                          d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                        />
                      </svg>
                    ) : (
                      <svg
                        className='w-4 h-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                    )}
                    {isLoading('testDanmuServer') ? '测试中...' : '连通测试'}
                  </button>
                </div>
              </div>

              {/* Token */}
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  API Token
                  <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                    官方稳定节点默认 decotv，留空则不携带 token
                  </span>
                </label>
                <input
                  type='text'
                  value={danmuSettings.token}
                  onChange={(e) =>
                    setDanmuSettings((prev) => ({
                      ...prev,
                      token: e.target.value,
                    }))
                  }
                  placeholder='decotv'
                  className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500'
                />
              </div>

              {/* 拼接后完整地址显示 */}
              {danmuSettings.serverUrl && (
                <div className='bg-gray-50 dark:bg-gray-900/30 rounded-lg p-3 border border-gray-100 dark:border-gray-700/50'>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    完整 API 端点
                  </p>
                  <p className='text-sm font-mono text-gray-700 dark:text-gray-300 break-all'>
                    {getFullServerUrl()}
                  </p>
                </div>
              )}

              {/* 连通测试结果 */}
              {testResult && (
                <div
                  className={`rounded-lg border p-3 ${
                    testResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
                      : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                  }`}
                >
                  <div className='flex items-start gap-2'>
                    {testResult.success ? (
                      <CheckCircle className='w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5' />
                    ) : (
                      <AlertCircle className='w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5' />
                    )}
                    <div className='text-sm'>
                      <p
                        className={`font-medium ${testResult.success ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'}`}
                      >
                        {testResult.success ? '服务器连接成功' : '连接失败'}
                      </p>
                      {testResult.success && (
                        <div className='mt-1 space-y-0.5 text-emerald-700 dark:text-emerald-400'>
                          <p>延迟: {testResult.latency}ms</p>
                          <p>
                            搜索接口:
                            {testResult.searchAvailable
                              ? ` 可用（测试返回 ${testResult.searchResultCount} 条结果）`
                              : ' 不可用'}
                          </p>
                        </div>
                      )}
                      {testResult.error && (
                        <p className='mt-1 text-red-600 dark:text-red-400'>
                          {testResult.error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 推荐节点快速选择 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-purple-500 rounded-full'></span>
                推荐节点（含稳定源）
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                已内置官方推荐稳定节点；历史演示站通常不稳定，建议优先使用自建服务。
              </p>
            </div>
            <div className='p-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'>
                {DEMO_DANMU_SERVERS.map((server) => {
                  const isSelected = danmuSettings.serverUrl === server.url;
                  return (
                    <button
                      key={server.url}
                      onClick={() => handleSelectDemoServer(server)}
                      className={`text-left p-3 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 bg-white dark:bg-gray-800'
                      }`}
                    >
                      <p
                        className={`text-sm font-medium ${
                          isSelected
                            ? 'text-purple-700 dark:text-purple-300'
                            : 'text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        {server.name}
                      </p>
                      {server.badge && (
                        <div className='mt-1'>
                          <span className='inline-flex rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-[11px] font-medium'>
                            {server.badge}
                          </span>
                        </div>
                      )}
                      <p className='text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5 truncate'>
                        {server.url}
                      </p>
                      {server.token && (
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          Token:{' '}
                          <span className='font-mono'>{server.token}</span>
                        </p>
                      )}
                      {isSelected && (
                        <div className='flex items-center gap-1 mt-1'>
                          <Check className='w-3 h-3 text-purple-500' />
                          <span className='text-xs text-purple-600 dark:text-purple-400'>
                            已选择
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between gap-3'>
              <div>
                <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                  <span className='w-1 h-4 bg-emerald-500 rounded-full'></span>
                  自定义节点库
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  管理多个弹幕节点，支持添加、编辑、删除、延迟测试和一键应用
                </p>
              </div>
              <button
                type='button'
                onClick={openAddNodeModal}
                className={buttonStyles.primarySmall}
              >
                添加节点
              </button>
            </div>
            <div className='p-4'>
              {customNodes.length === 0 ? (
                <div className='rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400'>
                  暂无自定义节点，点击右上角“添加节点”
                </div>
              ) : (
                <div className='space-y-2'>
                  {customNodes.map((node) => {
                    const selected = isNodeSelected(node);
                    const testLoadingKey = `testDanmuNode_${node.id}`;
                    const applyLoadingKey = `applyDanmuNode_${node.id}`;
                    return (
                      <div
                        key={node.id}
                        className={`rounded-lg border p-3 transition-all ${
                          selected
                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-900/20'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/20'
                        }`}
                      >
                        <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <p className='text-sm font-medium text-gray-800 dark:text-gray-100 truncate'>
                                {node.name}
                              </p>
                              {selected && (
                                <span className='inline-flex rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px]'>
                                  当前使用
                                </span>
                              )}
                            </div>
                            <p className='mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 break-all'>
                              {node.url}
                            </p>
                            {node.token && (
                              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                                Token:{' '}
                                <span className='font-mono'>{node.token}</span>
                              </p>
                            )}
                          </div>
                          <div className='flex flex-wrap items-center gap-2'>
                            {getNodeHealthView(node.id)}
                            <button
                              type='button'
                              onClick={() => handleTestNode(node)}
                              disabled={isLoading(testLoadingKey)}
                              className={`px-2 py-1 text-xs rounded-md ${
                                isLoading(testLoadingKey)
                                  ? buttonStyles.disabledSmall
                                  : buttonStyles.secondarySmall
                              }`}
                            >
                              {isLoading(testLoadingKey)
                                ? '测试中...'
                                : '测试延迟'}
                            </button>
                            <button
                              type='button'
                              onClick={() => handleApplyNode(node)}
                              disabled={isLoading(applyLoadingKey)}
                              className={`px-2 py-1 text-xs rounded-md ${
                                isLoading(applyLoadingKey)
                                  ? buttonStyles.disabledSmall
                                  : buttonStyles.successSmall
                              }`}
                            >
                              {isLoading(applyLoadingKey)
                                ? '应用中...'
                                : '使用此节点'}
                            </button>
                            <button
                              type='button'
                              onClick={() => openEditNodeModal(node)}
                              className={buttonStyles.primarySmall}
                            >
                              编辑
                            </button>
                            <button
                              type='button'
                              onClick={() => handleDeleteNode(node)}
                              className={buttonStyles.dangerSmall}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 弹幕来源平台优先级 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-amber-500 rounded-full'></span>
                弹幕来源平台优先级
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                选择并排列弹幕优先匹配的视频平台，留空则自动匹配
              </p>
            </div>
            <div className='p-4'>
              <div className='flex flex-wrap gap-2'>
                {PLATFORM_OPTIONS.map((opt) => {
                  const isActive = selectedPlatforms.includes(opt.value);
                  const order = selectedPlatforms.indexOf(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => togglePlatform(opt.value)}
                      className={`relative inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 ring-2 ring-amber-300 dark:ring-amber-700'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {isActive && (
                        <span className='mr-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold'>
                          {order + 1}
                        </span>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {selectedPlatforms.length > 0 && (
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-2'>
                  当前优先级: {selectedPlatforms.join(' > ')}
                </p>
              )}
            </div>
          </div>

          {/* 采集源配置 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-cyan-500 rounded-full'></span>
                采集源排序
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                选择启用的采集源并按优先级排列，未选择则使用服务器默认配置
              </p>
            </div>
            <div className='p-4'>
              <div className='flex flex-wrap gap-2'>
                {SOURCE_OPTIONS.map((opt) => {
                  const isActive = selectedSources.includes(opt.value);
                  const order = selectedSources.indexOf(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleSourceOrder(opt.value)}
                      className={`relative inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200 ring-2 ring-cyan-300 dark:ring-cyan-700'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {isActive && (
                        <span className='mr-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-cyan-500 text-white text-[10px] font-bold'>
                          {order + 1}
                        </span>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {selectedSources.length > 0 && (
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-2'>
                  当前排序: {selectedSources.join(' > ')}
                </p>
              )}
            </div>
          </div>

          {/* 高级配置折叠区 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className='w-full p-4 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors'
            >
              <div className='flex items-center gap-2'>
                <span className='w-1 h-4 bg-gray-400 rounded-full'></span>
                <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  高级配置
                </h4>
                <span className='text-xs text-gray-400 dark:text-gray-500'>
                  弹幕格式、颜色转换、数量限制、屏蔽词等
                </span>
              </div>
              <div className='text-gray-500 dark:text-gray-400'>
                {showAdvanced ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </div>
            </button>

            {showAdvanced && (
              <div className='p-4 space-y-4 border-t border-gray-100 dark:border-gray-700/50'>
                {/* 弹幕输出格式 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    弹幕输出格式
                  </label>
                  <div className='flex gap-3'>
                    {[
                      { value: 'json', label: 'JSON' },
                      { value: 'xml', label: 'XML (Bilibili 标准)' },
                    ].map((fmt) => (
                      <label
                        key={fmt.value}
                        className={`cursor-pointer flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all ${
                          danmuSettings.danmuOutputFormat === fmt.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-blue-200'
                        }`}
                      >
                        <input
                          type='radio'
                          name='danmuOutputFormat'
                          value={fmt.value}
                          checked={
                            danmuSettings.danmuOutputFormat === fmt.value
                          }
                          onChange={(e) =>
                            setDanmuSettings((prev) => ({
                              ...prev,
                              danmuOutputFormat: e.target.value as
                                | 'json'
                                | 'xml',
                            }))
                          }
                          className='sr-only'
                        />
                        <span className='text-sm font-medium'>{fmt.label}</span>
                        {danmuSettings.danmuOutputFormat === fmt.value && (
                          <Check className='w-4 h-4 text-blue-500' />
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 弹幕颜色转换 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    弹幕颜色转换
                  </label>
                  <div className='flex flex-wrap gap-2'>
                    {[
                      { value: 'default', label: '不转换' },
                      { value: 'white', label: '全部转白色' },
                      { value: 'color', label: '白色转随机彩色' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`cursor-pointer px-3 py-1.5 rounded-lg border-2 text-sm transition-all ${
                          danmuSettings.convertColor === opt.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-200'
                        }`}
                      >
                        <input
                          type='radio'
                          name='convertColor'
                          value={opt.value}
                          checked={danmuSettings.convertColor === opt.value}
                          onChange={(e) =>
                            setDanmuSettings((prev) => ({
                              ...prev,
                              convertColor: e.target.value as
                                | 'default'
                                | 'white'
                                | 'color',
                            }))
                          }
                          className='sr-only'
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 简繁转换 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    弹幕简繁体转换
                  </label>
                  <div className='flex flex-wrap gap-2'>
                    {[
                      { value: 'default', label: '不转换' },
                      { value: 'simplified', label: '繁体转简体' },
                      { value: 'traditional', label: '简体转繁体' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`cursor-pointer px-3 py-1.5 rounded-lg border-2 text-sm transition-all ${
                          danmuSettings.simplifiedTraditional === opt.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-200'
                        }`}
                      >
                        <input
                          type='radio'
                          name='simplifiedTraditional'
                          value={opt.value}
                          checked={
                            danmuSettings.simplifiedTraditional === opt.value
                          }
                          onChange={(e) =>
                            setDanmuSettings((prev) => ({
                              ...prev,
                              simplifiedTraditional: e.target.value as
                                | 'default'
                                | 'simplified'
                                | 'traditional',
                            }))
                          }
                          className='sr-only'
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 顶部/底部弹幕转浮动 */}
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                      顶部/底部弹幕转浮动
                    </p>
                    <p className='text-xs text-gray-500 dark:text-gray-400'>
                      部分播放器不支持顶部/底部弹幕时启用
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        convertTopBottomToScroll:
                          !prev.convertTopBottomToScroll,
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      danmuSettings.convertTopBottomToScroll
                        ? buttonStyles.toggleOn
                        : buttonStyles.toggleOff
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        buttonStyles.toggleThumb
                      } ${
                        danmuSettings.convertTopBottomToScroll
                          ? 'translate-x-6'
                          : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 弹幕数量限制 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    弹幕数量限制
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      单位: 千条 (0 = 不限制)
                    </span>
                  </label>
                  <input
                    type='number'
                    min={0}
                    max={100}
                    value={danmuSettings.danmuLimit}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        danmuLimit: parseInt(e.target.value) || 0,
                      }))
                    }
                    className='w-32 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all'
                  />
                </div>

                {/* 源合并配置 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    源合并配置
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      格式: 源1&源2,源3&源4 （用 & 合并，用 , 分组）
                    </span>
                  </label>
                  <input
                    type='text'
                    value={danmuSettings.mergeSourcePairs}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        mergeSourcePairs: e.target.value,
                      }))
                    }
                    placeholder='如 imgo&iqiyi,dandan&bahamut&animeko'
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500'
                  />
                </div>

                {/* B站 Cookie */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    哔哩哔哩 Cookie
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      填入后可获取完整弹幕和港澳台内容
                    </span>
                  </label>
                  <textarea
                    value={danmuSettings.bilibiliCookie}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        bilibiliCookie: e.target.value,
                      }))
                    }
                    placeholder='SESSDATA=xxx; bili_jct=xxx'
                    rows={2}
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500 resize-none'
                  />
                </div>

                {/* 弹幕屏蔽词 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    弹幕屏蔽词
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      支持正则表达式，用逗号分隔
                    </span>
                  </label>
                  <textarea
                    value={danmuSettings.blockedWords}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        blockedWords: e.target.value,
                      }))
                    }
                    placeholder='/.{20,}/,/签到|打卡|前排/'
                    rows={3}
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500 resize-none'
                  />
                </div>
              </div>
            )}
          </div>

          {/* 保存按钮 */}
          <div className='flex items-center justify-end gap-3 pt-2'>
            <button
              onClick={handleSave}
              disabled={isLoading('saveDanmuConfig')}
              className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                isLoading('saveDanmuConfig')
                  ? buttonStyles.disabled
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md'
              }`}
            >
              {isLoading('saveDanmuConfig') ? (
                <svg
                  className='w-4 h-4 animate-spin'
                  viewBox='0 0 24 24'
                  fill='none'
                >
                  <circle
                    className='opacity-25'
                    cx='12'
                    cy='12'
                    r='10'
                    stroke='currentColor'
                    strokeWidth='4'
                  />
                  <path
                    className='opacity-75'
                    fill='currentColor'
                    d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                  />
                </svg>
              ) : (
                <Check className='w-4 h-4' />
              )}
              {isLoading('saveDanmuConfig') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      )}

      {/* 保存按钮 - 当弹幕服务关闭时也需要保存 */}
      {!danmuSettings.enabled && (
        <div className='flex items-center justify-end gap-3 pt-2'>
          <button
            onClick={handleSave}
            disabled={isLoading('saveDanmuConfig')}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
              isLoading('saveDanmuConfig')
                ? buttonStyles.disabled
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md'
            }`}
          >
            {isLoading('saveDanmuConfig') ? (
              <svg
                className='w-4 h-4 animate-spin'
                viewBox='0 0 24 24'
                fill='none'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                />
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                />
              </svg>
            ) : (
              <Check className='w-4 h-4' />
            )}
            {isLoading('saveDanmuConfig') ? '保存中...' : '保存配置'}
          </button>
        </div>
      )}

      {isNodeModalOpen && (
        <div
          className='fixed inset-0 z-1002 flex items-center justify-center bg-black/60 p-4'
          onClick={closeNodeModal}
        >
          <div
            className='w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-5 py-4'>
              <h5 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                {editingNodeId ? '编辑自定义节点' : '添加自定义节点'}
              </h5>
              <button
                type='button'
                onClick={closeNodeModal}
                className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              >
                关闭
              </button>
            </div>
            <div className='space-y-4 px-5 py-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  节点名称
                </label>
                <input
                  type='text'
                  value={nodeForm.name}
                  onChange={(e) =>
                    setNodeForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder='例如：家庭节点 / 海外节点'
                  className='w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  服务地址
                </label>
                <input
                  type='text'
                  value={nodeForm.url}
                  onChange={(e) =>
                    setNodeForm((prev) => ({ ...prev, url: e.target.value }))
                  }
                  placeholder='https://danmu.example.com'
                  className='w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  API Token
                </label>
                <input
                  type='text'
                  value={nodeForm.token}
                  onChange={(e) =>
                    setNodeForm((prev) => ({ ...prev, token: e.target.value }))
                  }
                  placeholder='可留空'
                  className='w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                />
              </div>
            </div>
            <div className='flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-700 px-5 py-4'>
              <button
                type='button'
                onClick={closeNodeModal}
                className={buttonStyles.secondarySmall}
              >
                取消
              </button>
              <button
                type='button'
                onClick={handleSubmitNode}
                className={buttonStyles.primarySmall}
              >
                {editingNodeId ? '保存修改' : '添加节点'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

interface PrivateLibraryConfigPanelProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

const createEmptyConnector = (): PrivateLibraryConnector => ({
  id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  name: '新连接',
  displayName: '',
  type: 'emby',
  enabled: true,
  serverUrl: '',
  token: '',
  alistToken: '',
  username: '',
  password: '',
  rootPath: '/Media',
  userId: '',
  libraryFilter: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

interface PrivateLibraryScanStatus {
  ok: boolean;
  count: number;
  error?: string;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function validatePrivateConnector(
  connector: PrivateLibraryConnector,
): string | null {
  const name = connector.name.trim() || '未命名连接';
  const displayName = connector.displayName?.trim() || '';
  const serverUrl = connector.serverUrl.trim();
  const token = connector.token.trim();
  const hasAccountPassword = Boolean(
    connector.username?.trim() && connector.password?.trim(),
  );

  if (!serverUrl) {
    return `${name}：服务器地址不能为空`;
  }

  if (!isValidHttpUrl(serverUrl)) {
    return `${name}：服务器地址格式不正确`;
  }

  if (displayName.length > 32) {
    return `${name}：显示名称不能超过 32 个字符`;
  }

  if (connector.type === 'openlist') {
    if (!token && !hasAccountPassword) {
      return `${name}：OpenList 需要填写 Token，或填写用户名和密码`;
    }
    return null;
  }

  if (connector.type === 'xiaoya') {
    return null;
  }

  if (!token && !hasAccountPassword) {
    return `${name}：Emby / Jellyfin 需要填写 API Key，或填写用户名和密码`;
  }

  return null;
}

export const PrivateLibraryConfigPanel = ({
  config,
  refreshConfig,
}: PrivateLibraryConfigPanelProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();

  const [connectors, setConnectors] = useState<PrivateLibraryConnector[]>([]);
  const [scanResult, setScanResult] = useState<
    Record<string, PrivateLibraryScanStatus>
  >({});

  useEffect(() => {
    setConnectors(config?.PrivateLibraryConfig?.connectors || []);
  }, [config?.PrivateLibraryConfig?.connectors]);

  const persistConnectors = async (
    nextConnectors: PrivateLibraryConnector[],
    options?: {
      skipValidation?: boolean;
      successMessage?: string;
      errorMessage?: string;
      rollback?: () => void;
    },
  ) => {
    const validationError = options?.skipValidation
      ? undefined
      : nextConnectors
          .filter((connector) => connector.enabled)
          .map((connector) => validatePrivateConnector(connector))
          .find(Boolean);

    if (validationError) {
      showError(validationError, showAlert);
      return;
    }

    await withLoading('savePrivateLibraryConfig', async () => {
      try {
        const response = await fetch('/api/admin/private-library', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectors: nextConnectors }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || '保存失败');
        }
        await refreshConfig();
        showSuccess(
          options?.successMessage || '私人影库配置保存成功',
          showAlert,
        );
      } catch (error) {
        options?.rollback?.();
        showError(
          options?.errorMessage ||
            `保存私人影库配置失败：${error instanceof Error ? error.message : '未知错误'}`,
          showAlert,
        );
      }
    });
  };

  const patchConnector = (
    connectorId: string,
    patch: Partial<PrivateLibraryConnector>,
  ) => {
    setConnectors((prev) =>
      prev.map((item) =>
        item.id === connectorId
          ? {
              ...item,
              ...patch,
              updatedAt: Date.now(),
            }
          : item,
      ),
    );
  };

  const handleAddConnector = () => {
    if (connectors.length >= 3) {
      showError('最多仅支持 3 个私人影库连接', showAlert);
      return;
    }
    setConnectors((prev) => [...prev, createEmptyConnector()]);
  };

  const handleDeleteConnector = (connectorId: string) => {
    const target = connectors.find((item) => item.id === connectorId);
    const previousConnectors = connectors;
    const previousScanResult = scanResult;
    showAlert({
      type: 'warning',
      title: '删除连接',
      message: `确定删除“${target?.name || '该连接'}”吗？此操作只会移除当前配置。`,
      showConfirm: true,
      confirmText: '删除',
      cancelText: '取消',
      onConfirm: () => {
        const nextConnectors = previousConnectors.filter(
          (item) => item.id !== connectorId,
        );
        const nextScanResult = { ...previousScanResult };
        delete nextScanResult[connectorId];

        setConnectors(nextConnectors);
        setScanResult(nextScanResult);

        void persistConnectors(nextConnectors, {
          skipValidation: true,
          successMessage: '私人影库连接已删除',
          errorMessage: `删除私人影库连接失败：${target?.name || '该连接'} 未能删除`,
          rollback: () => {
            setConnectors(previousConnectors);
            setScanResult(previousScanResult);
          },
        });
      },
    });
  };

  const handleSave = async () => {
    await persistConnectors(connectors);
  };

  const handleTest = async (connector: PrivateLibraryConnector) => {
    const validationError = validatePrivateConnector(connector);
    if (validationError) {
      showError(validationError, showAlert);
      return;
    }

    await withLoading(`testPrivateConnector:${connector.id}`, async () => {
      try {
        const response = await fetch('/api/admin/private-library/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connector }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          ok?: boolean;
          detail?: string;
          error?: string;
        };
        if (!response.ok || !data.ok) {
          throw new Error(data.detail || data.error || '连接测试失败');
        }
        showSuccess(`${connector.name} 连接测试通过`, showAlert);
      } catch (error) {
        showError(
          `${connector.name} 测试失败：${error instanceof Error ? error.message : '未知错误'}`,
          showAlert,
        );
      }
    });
  };

  const handleScan = async (connectorId?: string) => {
    await withLoading(
      connectorId
        ? `scanPrivateConnector:${connectorId}`
        : 'scanPrivateConnector:all',
      async () => {
        try {
          const response = await fetch('/api/admin/private-library/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(connectorId ? { connectorId } : {}),
          });
          const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            result?: Record<string, PrivateLibraryScanStatus>;
            error?: string;
          };
          if (!response.ok || !data.ok || !data.result) {
            throw new Error(data.error || '扫描失败');
          }

          setScanResult((prev) => ({ ...prev, ...data.result }));

          const entries = Object.entries(data.result);
          const failed = entries.filter(([, item]) => !item.ok);
          const success = entries.filter(([, item]) => item.ok);

          if (connectorId) {
            const result = data.result[connectorId];
            const name =
              connectors.find((item) => item.id === connectorId)?.name ||
              '当前连接';
            if (result?.ok) {
              showSuccess(
                `${name} 扫描完成，发现 ${result.count} 个媒体文件`,
                showAlert,
              );
            } else {
              throw new Error(result?.error || '扫描失败');
            }
            return;
          }

          if (failed.length === 0) {
            showSuccess('全部连接扫描完成，资源数量已更新', showAlert);
            return;
          }

          if (success.length > 0) {
            showAlert({
              type: 'warning',
              title: '扫描部分完成',
              message: `成功 ${success.length} 个，失败 ${failed.length} 个。`,
              showConfirm: true,
            });
            return;
          }

          throw new Error(
            failed
              .map(([id, item]) => {
                const name =
                  connectors.find((connector) => connector.id === id)?.name ||
                  id;
                return `${name}：${item.error || '扫描失败'}`;
              })
              .join('；'),
          );
        } catch (error) {
          showError(
            `扫描失败：${error instanceof Error ? error.message : '未知错误'}`,
            showAlert,
          );
        }
      },
    );
  };

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-900/10 p-4 flex items-center justify-between gap-3'>
        <div>
          <p className='text-sm font-semibold text-blue-900 dark:text-blue-200'>
            私人影库连接
          </p>
          <p className='text-xs text-blue-700 dark:text-blue-300 mt-1'>
            支持 OpenList / 小雅 Alist / Emby / Jellyfin，最多 3 个连接
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={handleAddConnector}
            disabled={connectors.length >= 3}
            className={
              connectors.length >= 3
                ? buttonStyles.disabledSmall
                : buttonStyles.primarySmall
            }
          >
            新增连接
          </button>
          <button
            type='button'
            onClick={() => handleScan()}
            disabled={
              isLoading('scanPrivateConnector:all') || connectors.length === 0
            }
            className={
              isLoading('scanPrivateConnector:all') || connectors.length === 0
                ? buttonStyles.disabledSmall
                : buttonStyles.successSmall
            }
          >
            全量扫描
          </button>
        </div>
      </div>

      {connectors.length === 0 && (
        <div className='rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400'>
          暂无连接，点击“新增连接”开始配置
        </div>
      )}

      {connectors.map((connector, index) => (
        <div
          key={connector.id}
          className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'
        >
          <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between'>
            <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
              连接 {index + 1}
            </h4>
            <div className='flex items-center gap-2'>
              <button
                type='button'
                onClick={() => handleTest(connector)}
                disabled={isLoading(`testPrivateConnector:${connector.id}`)}
                className={
                  isLoading(`testPrivateConnector:${connector.id}`)
                    ? buttonStyles.disabledSmall
                    : buttonStyles.secondarySmall
                }
              >
                连通性测试
              </button>
              <button
                type='button'
                onClick={() => handleScan(connector.id)}
                disabled={isLoading(`scanPrivateConnector:${connector.id}`)}
                className={
                  isLoading(`scanPrivateConnector:${connector.id}`)
                    ? buttonStyles.disabledSmall
                    : buttonStyles.successSmall
                }
              >
                扫描
              </button>
              <button
                type='button'
                onClick={() => handleDeleteConnector(connector.id)}
                className={buttonStyles.dangerSmall}
              >
                删除
              </button>
            </div>
          </div>

          <div className='p-4 grid grid-cols-1 md:grid-cols-2 gap-3'>
            <input
              type='text'
              value={connector.name}
              onChange={(event) =>
                patchConnector(connector.id, { name: event.target.value })
              }
              placeholder='连接名称'
              className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
            />

            <input
              type='text'
              value={connector.displayName || ''}
              onChange={(event) =>
                patchConnector(connector.id, {
                  displayName: event.target.value,
                })
              }
              placeholder='显示名称（前端来源标签使用，可选）'
              className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
            />

            <select
              value={connector.type}
              onChange={(event) =>
                patchConnector(connector.id, {
                  type: event.target.value as PrivateLibraryConnector['type'],
                  rootPath:
                    event.target.value === 'xiaoya'
                      ? '/'
                      : connector.rootPath || '/Media',
                })
              }
              className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
            >
              <option value='openlist'>OpenList</option>
              <option value='xiaoya'>小雅 Alist</option>
              <option value='emby'>Emby</option>
              <option value='jellyfin'>Jellyfin</option>
            </select>

            <input
              type='text'
              value={connector.serverUrl}
              onChange={(event) =>
                patchConnector(connector.id, { serverUrl: event.target.value })
              }
              placeholder='服务地址，例如 http://emby.example.com:8096'
              className='md:col-span-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
            />

            {connector.type !== 'xiaoya' ? (
              <input
                type='text'
                value={connector.token}
                onChange={(event) =>
                  patchConnector(connector.id, { token: event.target.value })
                }
                placeholder='Token / API Key（可选）'
                className='md:col-span-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm font-mono'
              />
            ) : null}

            <div className='md:col-span-2 text-xs text-gray-500 dark:text-gray-400'>
              {connector.type === 'openlist'
                ? 'OpenList 可使用 Token，部分部署也可尝试用户名 + 密码；服务地址里直接填写端口。'
                : connector.type === 'xiaoya'
                  ? '小雅 Alist 兼容 Alist API。可留空密码直接访问；如实例开启了访问密码，服务端会先登录并缓存 token。播放 .strm 文件时会实时刷新阿里云盘直链。'
                  : 'Emby / Jellyfin 现已支持两种方式：API Key / Access Token，或用户名 + 密码登录。服务地址里直接填写端口，如 http://host:8096。UserId 仅用于播放进度回写，不填会尽量自动解析。'}
            </div>

            {connector.type === 'xiaoya' ? (
              <input
                type='password'
                value={connector.password || ''}
                onChange={(event) =>
                  patchConnector(connector.id, {
                    password: event.target.value,
                  })
                }
                placeholder='访问密码（可选）'
                className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
              />
            ) : (
              <>
                <input
                  type='text'
                  value={connector.username || ''}
                  onChange={(event) =>
                    patchConnector(connector.id, {
                      username: event.target.value,
                    })
                  }
                  placeholder='用户名（选填）'
                  className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
                />
                <input
                  type='password'
                  value={connector.password || ''}
                  onChange={(event) =>
                    patchConnector(connector.id, {
                      password: event.target.value,
                    })
                  }
                  placeholder='密码（选填）'
                  className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
                />
              </>
            )}

            {connector.type === 'openlist' || connector.type === 'xiaoya' ? (
              <input
                type='text'
                value={connector.rootPath || ''}
                onChange={(event) =>
                  patchConnector(connector.id, {
                    rootPath:
                      event.target.value ||
                      (connector.type === 'xiaoya' ? '/' : '/Media'),
                  })
                }
                placeholder={
                  connector.type === 'xiaoya'
                    ? '小雅根目录，例如 /电影'
                    : 'OpenList 根目录，例如 /Media'
                }
                className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm md:col-span-2'
              />
            ) : (
              <>
                <input
                  type='text'
                  value={connector.userId || ''}
                  onChange={(event) =>
                    patchConnector(connector.id, { userId: event.target.value })
                  }
                  placeholder='Emby/Jellyfin UserId（可选，用于已播放回写）'
                  className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
                />
                <input
                  type='text'
                  value={(connector.libraryFilter || []).join(', ')}
                  onChange={(event) =>
                    patchConnector(connector.id, {
                      libraryFilter: event.target.value
                        .split(',')
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder='媒体库过滤（可选，逗号分隔）'
                  className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-sm'
                />
              </>
            )}

            <label className='md:col-span-2 inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300'>
              <input
                type='checkbox'
                checked={connector.enabled}
                onChange={(event) =>
                  patchConnector(connector.id, {
                    enabled: event.target.checked,
                  })
                }
                className='rounded border-gray-300 text-blue-600 focus:ring-blue-500'
              />
              启用该连接
            </label>

            <div className='md:col-span-2 text-xs text-gray-500 dark:text-gray-400'>
              {scanResult[connector.id] ? (
                scanResult[connector.id]?.ok ? (
                  <span>
                    最近扫描结果：已扫描到{' '}
                    {scanResult[connector.id]?.count ?? 0} 个媒体文件
                  </span>
                ) : (
                  <span className='text-red-500 dark:text-red-400'>
                    最近扫描结果：
                    {scanResult[connector.id]?.error || '扫描失败'}
                  </span>
                )
              ) : (
                <span>尚未执行扫描</span>
              )}
            </div>
          </div>
        </div>
      ))}

      <div className='flex justify-end'>
        <button
          type='button'
          onClick={handleSave}
          disabled={isLoading('savePrivateLibraryConfig')}
          className={
            isLoading('savePrivateLibraryConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          }
        >
          {isLoading('savePrivateLibraryConfig')
            ? '保存中...'
            : '保存私人影库配置'}
        </button>
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
        onConfirm={alertModal.onConfirm}
        confirmText={alertModal.confirmText}
        cancelText={alertModal.cancelText}
      />
    </div>
  );
};
