import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../services/api.js";

export function usePosts(params = {}) {
  return useQuery({
    queryKey: ["posts", params],
    queryFn: () => api.get("/posts", { params }).then((r) => r.data),
  });
}

export function usePost(postId) {
  return useQuery({
    queryKey: ["post", postId],
    queryFn: () => api.get(`/posts/${postId}`).then((r) => r.data),
    enabled: !!postId,
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data) => api.post("/posts", data).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["posts"] }),
  });
}

export function useVotePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, type }) =>
      api.post(`/posts/${postId}/vote`, { type }).then((r) => r.data),
    onSuccess: (_, { postId }) => {
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
}

export function useVoteAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ answerId, postId, type }) =>
      api.post(`/answers/${answerId}/vote`, { type }).then((r) => r.data),
    onSuccess: (_, { postId }) => {
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
    },
  });
}

export function useSubmitAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ postId, body }) =>
      api.post(`/posts/${postId}/answers`, { body }).then((r) => r.data),
    onSuccess: (_, { postId }) => {
      queryClient.invalidateQueries({ queryKey: ["post", postId] });
    },
  });
}

export function useAcceptAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answerId) =>
      api.patch(`/answers/${answerId}/accept`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["post"] }),
  });
}

export function usePinAnswer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (answerId) =>
      api.patch(`/answers/${answerId}/pin`).then((r) => r.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["post"] }),
  });
}
