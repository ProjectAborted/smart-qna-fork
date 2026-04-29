import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api.js";
import RoleBadge from "../components/RoleBadge.jsx";
import toast from "react-hot-toast";

const ROLES = ["STUDENT", "TA", "ADMIN"];

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get("/admin/users").then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: ({ username, role }) =>
      api.patch(`/admin/users/${username}/role`, { role }),
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: () => toast.error("Failed to update role"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">User Management</h1>

      {ROLES.map((group) => (
        <div key={group} className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <h2 className="text-lg font-semibold text-gray-700">{group}</h2>
            <RoleBadge role={group} />
            <span className="text-sm text-gray-400">({data?.[group]?.length ?? 0})</span>
          </div>

          <div className="card divide-y divide-gray-100">
            {data?.[group]?.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400">No users in this group.</p>
            )}
            {data?.[group]?.map((u) => (
              <div key={u.username} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{u.email}</p>
                  <p className="text-xs text-gray-400">{u.username}</p>
                </div>
                <select
                  defaultValue={group}
                  onChange={(e) => mutation.mutate({ username: u.username, role: e.target.value })}
                  className="input w-36 text-sm"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

