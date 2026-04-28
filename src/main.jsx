import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Bell,
  Building2,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  Plus,
  Users,
} from "lucide-react";
import {
  endOfMonth,
  eachDayOfInterval,
  format,
  getDay,
  isSameDay,
  startOfMonth,
} from "date-fns";
import { supabase } from "./lib/supabaseClient";
import "./styles.css";

function eventClass(type) {
  if (type === "design_milestone") return "event event-red";
  if (type === "task") return "event event-orange";
  if (type === "ca_deadline") return "event event-yellow";
  if (type === "complete") return "event event-complete";
  if (type === "on_hold") return "event event-hold";
  return "event";
}

function normalizeBuildings(value) {
  if (Array.isArray(value)) return value.filter(Boolean);

  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function parseUserDate(input) {
  if (!input) return null;

  const trimmed = input.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDateForInput(dateValue) {
  if (!dateValue) return "";

  const [year, month, day] = dateValue.split("-");
  if (!year || !month || !day) return "";

  return `${month}/${day}/${year}`;
}

function formatTaskDueDate(dateValue) {
  if (!dateValue) return "No due date";

  return format(new Date(`${dateValue}T00:00:00`), "EEE, MMM d");
}

function splitParentAndSubtasks(tasks = []) {
  const parents = [];
  const subtasksByParent = new Map();

  tasks.forEach((task) => {
    if (task.parent_task_id) {
      const current = subtasksByParent.get(task.parent_task_id) || [];
      current.push(task);
      subtasksByParent.set(task.parent_task_id, current);
    } else {
      parents.push(task);
    }
  });

  return { parents, subtasksByParent };
}

function countCompletedSubtasks(subtasks = []) {
  return subtasks.filter((subtask) => subtask.is_complete).length;
}

function getSortedSubtasks(tasks = [], parentTaskId) {
  return tasks
    .filter((subtask) => subtask.parent_task_id === parentTaskId)
    .sort(
      (a, b) =>
        (a.created_at || "").localeCompare(b.created_at || "") ||
        (a.label || "").localeCompare(b.label || "")
    );
}

function formatActivityDate(dateValue) {
  if (!dateValue) return "";
  return format(new Date(dateValue), "MMM d, h:mm a");
}

function getActivityText(item) {
  const details = item.details ? ` — ${item.details}` : "";

  const labels = {
    task_completed: "Task completed",
    task_reopened: "Task reopened",
    task_updated: "Task edited",
    subtask_completed: "Subtask completed",
    subtask_reopened: "Subtask reopened",
    subtask_updated: "Subtask edited",
    milestone_date_changed: "Milestone date changed",
    task_waiting_started: "Task marked waiting",
    task_waiting_cleared: "Task waiting cleared",
  };

  return `${labels[item.action] || item.action || "Activity"}${details}`;
}

function ActivityPanel({ logs = [] }) {
  const recentLogs = [...logs]
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 8);

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h4>Activity</h4>
        <span>{recentLogs.length}</span>
      </div>

      {recentLogs.length === 0 ? (
        <p className="muted-text">No activity yet. The audit goblin is waiting.</p>
      ) : (
        <div className="activity-list">
          {recentLogs.map((item) => (
            <div className="activity-row" key={item.id}>
              <span>{getActivityText(item)}</span>
              <em>{formatActivityDate(item.created_at)}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isTaskOverdue(task) {
  if (!task?.due_date || task.is_complete || task.is_waiting || task.parent_task_id) {
    return false;
  }

  return daysFromToday(task.due_date) < 0;
}

function parseDateOnly(dateValue) {
  if (!dateValue) return null;
  return new Date(`${dateValue}T00:00:00`);
}

function todayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function daysFromToday(dateValue) {
  const date = parseDateOnly(dateValue);
  if (!date) return null;
  const today = todayDateOnly();
  return Math.round((date - today) / (1000 * 60 * 60 * 24));
}

function daysWaiting(task) {
  if (!task?.waiting_since) return 0;

  const start = new Date(task.waiting_since);
  if (Number.isNaN(start.getTime())) return 0;

  const now = new Date();
  return Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24)));
}

function isTaskWaitingTooLong(task, thresholdDays = 5) {
  return Boolean(
    task &&
      task.is_waiting &&
      !task.is_complete &&
      !task.parent_task_id &&
      daysWaiting(task) >= thresholdDays
  );
}

function collectProjectTasks(projects) {
  return projects
    .flatMap((project) => {
      const generalTasks = (project.tasks || [])
        .filter((task) => !task.building_id)
        .map((task) => ({
          ...task,
          project_title: project.title,
          project_id: project.id,
          scope_name: "General",
        }));

      const buildingTasks = (project.buildings || []).flatMap((building) =>
        (building.tasks || []).map((task) => ({
          ...task,
          project_title: project.title,
          project_id: project.id,
          scope_name: building.name,
        }))
      );

      return [...generalTasks, ...buildingTasks].filter((task) => !task.parent_task_id);
    })
    .sort(
      (a, b) =>
        (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") ||
        (a.project_title || "").localeCompare(b.project_title || "") ||
        (a.label || "").localeCompare(b.label || "")
    );
}

function TaskAttentionList({
  title,
  tasks,
  emptyText,
  defaultCollapsed = false,
  onCompleteTask = () => {},
  onJumpToProject = () => {},
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`attention-panel ${isCollapsed ? "attention-panel-collapsed" : ""}`}>
      <button
        type="button"
        className="attention-panel-header attention-panel-toggle"
        onClick={() => setIsCollapsed((current) => !current)}
        aria-expanded={!isCollapsed}
      >
        <span className="attention-title-wrap">
          <span className="attention-disclosure-arrow">
            {isCollapsed ? "▶" : "▼"}
          </span>
          <h3>{title}</h3>
        </span>
        <span className="attention-count">{tasks.length}</span>
      </button>

      {!isCollapsed && (
        tasks.length === 0 ? (
          <p className="muted-text">{emptyText}</p>
        ) : (
          <div className="deadline-list compact-list">
            {tasks.map((task) => (
              <div
                className="deadline-row clickable-row dashboard-task-row"
                key={task.id}
                onClick={() => onJumpToProject(task.project_id, task.id)}
              >
                <div>
                  <strong>{task.label}</strong>
                  <span>
                    {task.project_title} · {task.scope_name}
                    {task.milestones?.label ? ` · ${task.milestones.label}` : ""}
                  </span>
                </div>

                <div className="dashboard-task-actions">
                  <div className="deadline-date">
                    {task.due_date
                      ? format(parseDateOnly(task.due_date), "EEE, MMM d")
                      : "No date"}
                  </div>

                  <label
                    className="dashboard-complete-check"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={false}
                      onChange={() => onCompleteTask(task)}
                    />
                    Complete
                  </label>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function StaleWaitingList({ tasks, defaultCollapsed = false, onJumpToProject = () => {} }) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  return (
    <div className={`attention-panel waiting-too-long-panel ${isCollapsed ? "attention-panel-collapsed" : ""}`}>
      <button
        type="button"
        className="attention-panel-header attention-panel-toggle"
        onClick={() => setIsCollapsed((current) => !current)}
        aria-expanded={!isCollapsed}
      >
        <span className="attention-title-wrap">
          <span className="attention-disclosure-arrow">
            {isCollapsed ? "▶" : "▼"}
          </span>
          <h3>Waiting Too Long</h3>
        </span>
        <span className="attention-count">{tasks.length}</span>
      </button>

      {!isCollapsed && (
        tasks.length === 0 ? (
          <p className="muted-text">No waiting tasks older than 5 days. That is suspiciously adult.</p>
        ) : (
          <div className="deadline-list compact-list">
            {tasks.map((task) => (
              <div
                className="deadline-row clickable-row dashboard-task-row waiting-too-long-row"
                key={task.id}
                onClick={() => onJumpToProject(task.project_id, task.id)}
              >
                <div>
                  <strong>{task.label}</strong>
                  <span>
                    {task.project_title} · {task.scope_name}
                    {task.milestones?.label ? ` · ${task.milestones.label}` : ""}
                  </span>
                </div>

                <div className="dashboard-task-actions">
                  <div className="deadline-date waiting-days">
                    Waiting {daysWaiting(task)} days
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function CalendarMonth({ events, toggles, onEventClick }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  function goToPreviousMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    );
  }

  function goToToday() {
    setCurrentMonth(new Date());
  }

  function goToNextMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    );
  }

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const leadingBlanks = Array.from({
    length: getDay(startOfMonth(currentMonth)),
  });

  const visibleEvents = events.filter((event) => {
    if (event.event_type === "design_milestone") return toggles.designMilestones;
    if (event.event_type === "task") return toggles.tasks;
    if (event.event_type === "ca_deadline") return toggles.caDeadlines;
    return true;
  });

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>Calendar</h2>
          <p>Month view only. Week views are where ambition goes to get lost.</p>
        </div>
        <div className="calendar-controls">
          <button type="button" onClick={goToPreviousMonth}>
            Prev
          </button>
          <button type="button" onClick={goToToday}>
            Today
          </button>
          <button type="button" onClick={goToNextMonth}>
            Next
          </button>
          <strong>{format(currentMonth, "MMMM yyyy")}</strong>
        </div>
      </div>

      <div className="calendar-grid calendar-days">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>

      <div className="calendar-grid">
        {leadingBlanks.map((_, index) => (
          <div className="calendar-cell muted-cell" key={`blank-${index}`} />
        ))}

        {days.map((day) => {
          const dayEvents = visibleEvents.filter((event) =>
            isSameDay(new Date(`${event.due_date}T00:00:00`), day)
          );

          return (
            <div className="calendar-cell" key={day.toISOString()}>
              <div className="day-number">{format(day, "d")}</div>

              {dayEvents.slice(0, 2).map((event) => {
                const buildings = normalizeBuildings(
                  event.buildings || event.building_names
                );

                return (
                  <button
                    type="button"
                    className={eventClass(event.event_type)}
                    key={event.id}
                    onClick={() => onEventClick(event)}
                  >
                    <strong>{event.project_title}</strong>
                    {buildings.length > 0 && <span>{buildings.join(", ")}</span>}
                    <span>{event.label}</span>
                  </button>
                );
              })}

              {dayEvents.length > 2 && (
                <div className="more">+{dayEvents.length - 2} more</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Dashboard({ events, projects, teamMembers = [], onJumpToProject = () => {}, onDataChanged = async () => {} }) {
  const [selectedDashboardAssigneeId, setSelectedDashboardAssigneeId] = useState("");
  const sortedEvents = [...events].sort((a, b) =>
    (a.due_date || "").localeCompare(b.due_date || "")
  );

  const allTasks = collectProjectTasks(projects);
  const incompleteDatedTasks = allTasks.filter(
    (task) => !task.is_complete && !task.is_waiting && task.due_date
  );

  const overdueTasks = incompleteDatedTasks.filter(
    (task) => daysFromToday(task.due_date) < 0
  );

  const dueThisWeekTasks = incompleteDatedTasks.filter((task) => {
    const days = daysFromToday(task.due_date);
    return days >= 0 && days <= 7;
  });

  const staleWaitingTasks = allTasks
    .filter((task) => isTaskWaitingTooLong(task))
    .sort(
      (a, b) =>
        daysWaiting(b) - daysWaiting(a) ||
        (a.project_title || "").localeCompare(b.project_title || "") ||
        (a.label || "").localeCompare(b.label || "")
    );

  const upcomingMilestones = sortedEvents
    .filter((event) => {
      const days = daysFromToday(event.due_date);
      return days !== null && days >= 0;
    })
    .slice(0, 8);

  const openTasks = allTasks.filter((task) => !task.is_complete);

  const assignedTaskCounts = teamMembers.map((member) => ({
    ...member,
    openCount: openTasks.filter((task) => task.assigned_to === member.id).length,
    overdueCount: openTasks.filter((task) => {
      if (task.assigned_to !== member.id || !task.due_date) return false;
      return daysFromToday(task.due_date) < 0;
    }).length,
  }));

  const unassignedOpenCount = openTasks.filter((task) => !task.assigned_to).length;

  const effectiveAssigneeId = selectedDashboardAssigneeId || teamMembers[0]?.id || "";
  const selectedAssignee =
    teamMembers.find((member) => member.id === effectiveAssigneeId) || null;

  const selectedAssigneeTasks = openTasks
    .filter((task) => task.assigned_to === effectiveAssigneeId)
    .sort((a, b) => {
      const aDate = a.due_date || "9999-12-31";
      const bDate = b.due_date || "9999-12-31";

      return aDate.localeCompare(bDate) || (a.label || "").localeCompare(b.label || "");
    });

  const selectedOverdueTasks = selectedAssigneeTasks.filter((task) => {
    if (!task.due_date || task.is_waiting) return false;
    return daysFromToday(task.due_date) < 0;
  });

  const selectedUpcomingTasks = selectedAssigneeTasks.filter((task) => {
    if (!task.due_date) return true;
    return daysFromToday(task.due_date) >= 0;
  });

  function groupTasksByProject(tasks) {
    const groups = new Map();

    tasks.forEach((task) => {
      const projectTitle = task.project_title || "Unknown Project";

      if (!groups.has(projectTitle)) {
        groups.set(projectTitle, []);
      }

      groups.get(projectTitle).push(task);
    });

    return Array.from(groups.entries()).map(([projectTitle, groupedTasks]) => ({
      projectTitle,
      tasks: groupedTasks,
    }));
  }

  const overdueTaskGroups = groupTasksByProject(selectedOverdueTasks);
  const upcomingTaskGroups = groupTasksByProject(selectedUpcomingTasks);

  async function completeDashboardTask(task) {
    const { error } = await supabase
      .from("tasks")
      .update({ is_complete: true })
      .eq("id", task.id);

    if (error) {
      console.error("Failed to complete task from dashboard:", error);
      alert("Failed to complete task");
    } else {
      await onDataChanged();
    }
  }

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>Deadline Dashboard</h2>
          <p>Now with less guessing and more “oh crap, that’s due Friday.”</p>
        </div>
      </div>

      <div className="attention-grid">
        <TaskAttentionList
          title="Overdue Tasks"
          tasks={overdueTasks}
          emptyText="Nothing overdue. Suspicious, but beautiful."
          onCompleteTask={completeDashboardTask}
          onJumpToProject={onJumpToProject}
        />

        <TaskAttentionList
          title="Due This Week"
          tasks={dueThisWeekTasks}
          emptyText="No incomplete tasks due in the next 7 days."
          onCompleteTask={completeDashboardTask}
          onJumpToProject={onJumpToProject}
        />

        <StaleWaitingList
          tasks={staleWaitingTasks}
          onJumpToProject={onJumpToProject}
        />
      </div>

      <div className="attention-panel full-width-panel">
        <div className="attention-panel-header">
          <h3>Upcoming Milestones</h3>
          <span>{upcomingMilestones.length}</span>
        </div>

        <div className="my-tasks-panel">
        <div className="my-tasks-header">
          <div>
            <h3>My Tasks</h3>
            <p>
              {selectedAssignee
                ? "Open tasks assigned to " + selectedAssignee.name
                : "Add a team member to start assigning tasks."}
            </p>
          </div>

          <select
            value={effectiveAssigneeId}
            onChange={(event) => setSelectedDashboardAssigneeId(event.target.value)}
          >
            {teamMembers.length === 0 && <option value="">No team members yet</option>}
            {teamMembers.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>

        {!selectedAssignee && (
          <div className="empty-state">No person selected yet.</div>
        )}

        {selectedAssignee && selectedAssigneeTasks.length === 0 && (
          <div className="empty-state">
            No open tasks assigned to {selectedAssignee.name}. Suspiciously peaceful.
          </div>
        )}

        {selectedAssignee && overdueTaskGroups.length > 0 && (
          <div className="my-task-group">
            <h4>Overdue</h4>
            {overdueTaskGroups.map((group) => (
              <div className="my-project-task-group" key={"overdue-" + group.projectTitle}>
                <div className="my-project-task-header">
                  <strong>{group.projectTitle}</strong>
                  <span>{group.tasks.length} task{group.tasks.length === 1 ? "" : "s"}</span>
                </div>

                {group.tasks.map((task) => (
                  <div
                    className="my-task-row my-task-overdue clickable-row"
                    key={task.id}
                    onClick={() => onJumpToProject(task.project_id, task.id)}
                  >
                    <div>
                      <strong>{task.label}</strong>
                      <span>
                        {task.scope_name}
                        {task.milestones?.label ? " · " + task.milestones.label : ""}
                      </span>
                    </div>
                    <div className="dashboard-task-actions">
                      <em>Due {formatTaskDueDate(task.due_date)}</em>
                      <label
                        className="dashboard-complete-check"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => completeDashboardTask(task)}
                        />
                        Complete
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {selectedAssignee && upcomingTaskGroups.length > 0 && (
          <div className="my-task-group">
            <h4>Upcoming / Undated</h4>
            {upcomingTaskGroups.map((group) => (
              <div className="my-project-task-group" key={"upcoming-" + group.projectTitle}>
                <div className="my-project-task-header">
                  <strong>{group.projectTitle}</strong>
                  <span>{group.tasks.length} task{group.tasks.length === 1 ? "" : "s"}</span>
                </div>

                {group.tasks.map((task) => (
                  <div
                    className="my-task-row clickable-row"
                    key={task.id}
                    onClick={() => onJumpToProject(task.project_id, task.id)}
                  >
                    <div>
                      <strong>{task.label}</strong>
                      <span>
                        {task.scope_name}
                        {task.milestones?.label ? " · " + task.milestones.label : ""}
                      </span>
                    </div>
                    <div className="dashboard-task-actions">
                      <em>{task.due_date ? "Due " + formatTaskDueDate(task.due_date) : "No due date"}</em>
                      <label
                        className="dashboard-complete-check"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={false}
                          onChange={() => completeDashboardTask(task)}
                        />
                        Complete
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="assignment-summary">
        <h3>Open Tasks by Person</h3>
        <div className="assignment-grid">
          {assignedTaskCounts.map((member) => (
            <div className="assignment-card" key={member.id}>
              <strong>{member.name}</strong>
              <span>{member.openCount} open</span>
              {member.overdueCount > 0 && (
                <em>{member.overdueCount} overdue</em>
              )}
            </div>
          ))}

          <div className="assignment-card assignment-unassigned">
            <strong>Unassigned</strong>
            <span>{unassignedOpenCount} open</span>
          </div>
        </div>
      </div>

      <div className="deadline-list">
          {upcomingMilestones.map((event) => {
            const buildings = normalizeBuildings(
              event.buildings || event.building_names
            );

            return (
              <div
              className="deadline-row clickable-row"
              key={event.id}
              onClick={() => onJumpToProject(event.project_id)}
            >
                <div>
                  <strong>{event.project_title}</strong>
                  <span>
                    {buildings.length > 0 ? buildings.join(", ") : "General"} ·{" "}
                    {event.label}
                  </span>
                </div>
                <div className="deadline-date">
                  {event.due_date
                    ? format(new Date(`${event.due_date}T00:00:00`), "EEE, MMM d")
                    : "No date"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Projects({ projects, teamMembers = [], activityLogs = [], onDataChanged }) {
  const [milestoneProjectId, setMilestoneProjectId] = useState(null);
  const [milestoneLabel, setMilestoneLabel] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [selectedBuildingIds, setSelectedBuildingIds] = useState([]);
  const [savingMilestone, setSavingMilestone] = useState(false);
  const [editingBuildingId, setEditingBuildingId] = useState(null);
  const [editingBuildingName, setEditingBuildingName] = useState("");
  const [editingMilestoneId, setEditingMilestoneId] = useState(null);
  const [taskBuildingId, setTaskBuildingId] = useState(null);
  const [taskLabel, setTaskLabel] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskMilestoneId, setTaskMilestoneId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskNotes, setTaskNotes] = useState("");
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [savingTask, setSavingTask] = useState(false);
  const [subtaskParentId, setSubtaskParentId] = useState(null);
  const [subtaskLabel, setSubtaskLabel] = useState("");
  const [editingSubtaskId, setEditingSubtaskId] = useState(null);
  const [editingSubtaskLabel, setEditingSubtaskLabel] = useState("");
  const [collapsedSubtaskParentIds, setCollapsedSubtaskParentIds] = useState([]);
  const [collapsedMilestoneProjectIds, setCollapsedMilestoneProjectIds] = useState([]);
  const [collapsedBuildingIds, setCollapsedBuildingIds] = useState([]);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("deadlineTrackerCollapsedProjects") || "[]");
    } catch {
      return [];
    }
  });
  const [showCompletedTasks, setShowCompletedTasks] = useState(true);
  const [hideCompletedProjects, setHideCompletedProjects] = useState(false);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [showOnlyOverdueProjects, setShowOnlyOverdueProjects] = useState(false);
  const [smartView, setSmartView] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [newTeamMemberName, setNewTeamMemberName] = useState("");
  const [editingTeamMemberId, setEditingTeamMemberId] = useState(null);
  const [editingTeamMemberName, setEditingTeamMemberName] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectForm, setProjectForm] = useState({
    title: "",
    project_number: "",
    client: "",
    architect: "",
    status: "Design",
  });
  const [draggedProjectId, setDraggedProjectId] = useState(null);

  useEffect(() => {
    localStorage.setItem(
      "deadlineTrackerCollapsedProjects",
      JSON.stringify(collapsedProjectIds)
    );
  }, [collapsedProjectIds]);

  useEffect(() => {
    setEditingSubtaskId(null);
    setEditingSubtaskLabel("");
  }, [projects]);

  useEffect(() => {
    function closeOpenMenusOnOutsideClick(event) {
      const openMenus = document.querySelectorAll(
        "details.compact-menu[open], details.task-actions-menu[open]"
      );

      openMenus.forEach((menu) => {
        if (!menu.contains(event.target)) {
          menu.removeAttribute("open");
        }
      });
    }

    function closeOpenMenusOnEscape(event) {
      if (event.key !== "Escape") return;

      document
        .querySelectorAll("details.compact-menu[open], details.task-actions-menu[open]")
        .forEach((menu) => menu.removeAttribute("open"));
    }

    document.addEventListener("mousedown", closeOpenMenusOnOutsideClick);
    document.addEventListener("keydown", closeOpenMenusOnEscape);

    return () => {
      document.removeEventListener("mousedown", closeOpenMenusOnOutsideClick);
      document.removeEventListener("keydown", closeOpenMenusOnEscape);
    };
  }, []);

  function updateProjectForm(field, value) {
    setProjectForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function resetProjectForm() {
    setProjectForm({
      title: "",
      project_number: "",
      client: "",
      architect: "",
      status: "Design",
    });
  }

  async function addProject() {
    setShowProjectForm(true);
  }

  async function saveNewProject() {
    if (!projectForm.title.trim()) {
      alert("Please enter a project title.");
      return;
    }

    const sortOrder =
      projects.reduce(
        (max, project) => Math.max(max, Number(project.sort_order || 0)),
        0
      ) + 10;

    const { error } = await supabase.from("projects").insert([
      {
        title: projectForm.title.trim(),
        project_number: projectForm.project_number.trim() || "TBD",
        client: projectForm.client.trim() || "TBD",
        architect: projectForm.architect.trim() || "TBD",
        status: projectForm.status,
        sort_order: sortOrder,
      },
    ]);

    if (error) {
      console.error("Failed to create project:", error);
      alert("Failed to create project");
    } else {
      resetProjectForm();
      setShowProjectForm(false);
      await onDataChanged();
    }
  }

  function cancelNewProject() {
    resetProjectForm();
    setShowProjectForm(false);
  }

  async function addBuilding(projectId) {
    const name = prompt("Building name?");
    if (!name?.trim()) return;

    const { error } = await supabase.from("buildings").insert([
      {
        project_id: projectId,
        name: name.trim(),
      },
    ]);

    if (error) {
      console.error("Failed to add building:", error);
      alert("Failed to add building");
    } else {
      await onDataChanged();
    }
  }

  function editBuilding(building) {
    setEditingBuildingId(building.id);
    setEditingBuildingName(building.name || "");
    setCollapsedBuildingIds((current) =>
      current.filter((id) => id !== building.id)
    );
  }

  function cancelEditBuilding() {
    setEditingBuildingId(null);
    setEditingBuildingName("");
  }

  async function saveEditedBuilding(building) {
    if (!editingBuildingName.trim()) {
      alert("Please enter a building name.");
      return;
    }

    const { error } = await supabase
      .from("buildings")
      .update({ name: editingBuildingName.trim() })
      .eq("id", building.id);

    if (error) {
      console.error("Failed to update building:", error);
      alert("Failed to update building");
    } else {
      cancelEditBuilding();
      await onDataChanged();
    }
  }

  async function deleteBuilding(building) {
    const confirmed = confirm(
      `Delete "${building.name}"? Any milestone links to this building will also be removed.`
    );

    if (!confirmed) return;

    const { error } = await supabase.from("buildings").delete().eq("id", building.id);

    if (error) {
      console.error("Failed to delete building:", error);
      alert("Failed to delete building");
    } else {
      await onDataChanged();
    }
  }

  async function updateProjectStatus(projectId, status) {
    const { error } = await supabase
      .from("projects")
      .update({ status })
      .eq("id", projectId);

    if (error) {
      console.error("Failed to update project status:", error);
      alert("Failed to update project status");
    } else {
      await onDataChanged();
    }
  }

  function openMilestoneForm(projectId) {
    setMilestoneProjectId(projectId);
    setEditingMilestoneId(null);
    setMilestoneLabel("");
    setMilestoneDate("");
    setSelectedBuildingIds([]);
  }

  function openEditMilestoneForm(projectId, milestone) {
    const linkedBuildingIds =
      milestone.milestone_buildings?.map((link) => link.building_id) || [];

    setMilestoneProjectId(projectId);
    setEditingMilestoneId(milestone.id);
    setMilestoneLabel(milestone.label || "");
    setMilestoneDate(formatDateForInput(milestone.due_date));
    setSelectedBuildingIds(linkedBuildingIds);
  }

  function closeMilestoneForm() {
    setMilestoneProjectId(null);
    setEditingMilestoneId(null);
    setMilestoneLabel("");
    setMilestoneDate("");
    setSelectedBuildingIds([]);
  }

  function toggleBuilding(buildingId) {
    setSelectedBuildingIds((current) =>
      current.includes(buildingId)
        ? current.filter((id) => id !== buildingId)
        : [...current, buildingId]
    );
  }

  async function replaceMilestoneBuildingLinks(milestoneId) {
    const { error: deleteError } = await supabase
      .from("milestone_buildings")
      .delete()
      .eq("milestone_id", milestoneId);

    if (deleteError) throw deleteError;

    if (selectedBuildingIds.length === 0) return;

    const rows = selectedBuildingIds.map((buildingId) => ({
      milestone_id: milestoneId,
      building_id: buildingId,
    }));

    const { error: insertError } = await supabase
      .from("milestone_buildings")
      .insert(rows);

    if (insertError) throw insertError;
  }

  async function saveMilestone(projectId) {
    const currentProject = projects.find((project) => project.id === projectId);
    const previousMilestone = currentProject?.milestones?.find(
      (milestone) => milestone.id === editingMilestoneId
    );
    const previousDueDate = previousMilestone?.due_date || null;
    const dueDate = parseUserDate(milestoneDate);

    if (!milestoneLabel.trim()) {
      alert("Please enter a milestone name.");
      return;
    }

    if (!dueDate) {
      alert("Please enter the date as MM/DD/YYYY, like 05/15/2026.");
      return;
    }

    setSavingMilestone(true);

    try {
      if (editingMilestoneId) {
        const { error } = await supabase
          .from("milestones")
          .update({
            label: milestoneLabel.trim(),
            due_date: dueDate,
          })
          .eq("id", editingMilestoneId);

        if (error) throw error;

        await replaceMilestoneBuildingLinks(editingMilestoneId);

        if (previousDueDate && previousDueDate !== dueDate) {
          await recordActivity({
            projectId,
            milestoneId: editingMilestoneId,
            action: "milestone_date_changed",
            details: `${milestoneLabel.trim()} moved from ${formatDateForInput(previousDueDate)} to ${formatDateForInput(dueDate)}`,
          });
        }
      } else {
        const { data, error } = await supabase
          .from("milestones")
          .insert([
            {
              project_id: projectId,
              label: milestoneLabel.trim(),
              due_date: dueDate,
              is_ca_deadline: false,
            },
          ])
          .select("id")
          .single();

        if (error) throw error;

        if (data?.id) {
          await replaceMilestoneBuildingLinks(data.id);
        }
      }

      closeMilestoneForm();
      await onDataChanged();
    } catch (error) {
      console.error("Failed to save milestone:", error);
      alert("Failed to save milestone");
    } finally {
      setSavingMilestone(false);
    }
  }

  async function deleteMilestone(milestone) {
    const confirmed = confirm(`Delete milestone "${milestone.label}"?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from("milestones")
      .delete()
      .eq("id", milestone.id);

    if (error) {
      console.error("Failed to delete milestone:", error);
      alert("Failed to delete milestone");
    } else {
      await onDataChanged();
    }
  }

  function openTaskForm(scopeId) {
    setTaskBuildingId(scopeId);
    setTaskLabel("");
    setTaskDueDate("");
    setTaskMilestoneId("");
    setTaskAssigneeId("");
    setTaskNotes("");
    setEditingTaskId(null);
  }

  function openEditTaskForm(scopeId, task) {
    setTaskBuildingId(scopeId);
    setTaskLabel(task.label || "");
    setTaskDueDate(task.due_date || "");
    setTaskMilestoneId(task.milestone_id || "");
    setTaskAssigneeId(task.assigned_to || "");
    setTaskNotes(task.notes || "");
    setEditingTaskId(task.id);
  }

  function closeTaskForm() {
    setTaskBuildingId(null);
    setTaskLabel("");
    setTaskDueDate("");
    setTaskMilestoneId("");
    setTaskAssigneeId("");
    setTaskNotes("");
    setEditingTaskId(null);
  }

  async function saveTask(projectId, buildingId = null) {
    if (!taskLabel.trim()) {
      alert("Please enter a task name.");
      return;
    }

    const dueDate = taskDueDate.trim() ? parseUserDate(taskDueDate) : null;

    if (taskDueDate.trim() && !dueDate) {
      alert("Please pick a valid task due date.");
      return;
    }

    setSavingTask(true);

    const taskPayload = {
      project_id: projectId,
      building_id: buildingId,
      milestone_id: taskMilestoneId || null,
      assigned_to: taskAssigneeId || null,
      label: taskLabel.trim(),
      due_date: dueDate,
      notes: taskNotes.trim() || null,
      parent_task_id: null,
    };

    const { error } = editingTaskId
      ? await supabase.from("tasks").update(taskPayload).eq("id", editingTaskId)
      : await supabase.from("tasks").insert([
          {
            ...taskPayload,
            is_complete: false,
          },
        ]);

    if (error) {
      console.error("Failed to save task:", error);
      alert("Failed to save task");
    } else {
      if (editingTaskId) {
        await recordActivity({
          projectId,
          taskId: editingTaskId,
          action: "task_updated",
          details: taskLabel.trim(),
        });
      }

      closeTaskForm();
      await onDataChanged();
    }

    setSavingTask(false);
  }

  async function toggleTask(task) {
    const nextComplete = !task.is_complete;
    const { error } = await supabase
      .from("tasks")
      .update({ is_complete: nextComplete })
      .eq("id", task.id);

    if (error) {
      console.error("Failed to update task:", error);
      alert("Failed to update task");
    } else {
      await recordActivity({
        projectId: task.project_id,
        taskId: task.id,
        action: task.parent_task_id
          ? nextComplete
            ? "subtask_completed"
            : "subtask_reopened"
          : nextComplete
            ? "task_completed"
            : "task_reopened",
        details: task.label || "Untitled task",
      });
      await onDataChanged();
    }
  }

  async function deleteTask(task) {
    const confirmed = confirm(`Delete task "${task.label}"?`);
    if (!confirmed) return;

    const { error } = await supabase.from("tasks").delete().eq("id", task.id);

    if (error) {
      console.error("Failed to delete task:", error);
      alert("Failed to delete task");
    } else {
      await onDataChanged();
    }
  }

  function toggleProjectCollapsed(projectId) {
    setCollapsedProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }

  function expandAllProjects() {
    setCollapsedProjectIds([]);
  }

  function collapseAllProjects() {
    setCollapsedProjectIds(projects.map((project) => project.id));
  }

  async function reorderProjects(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;

    const orderedProjects = [...projects];
    const fromIndex = orderedProjects.findIndex((project) => project.id === draggedId);
    const toIndex = orderedProjects.findIndex((project) => project.id === targetId);

    if (fromIndex === -1 || toIndex === -1) return;

    const [movedProject] = orderedProjects.splice(fromIndex, 1);
    orderedProjects.splice(toIndex, 0, movedProject);

    const updates = orderedProjects.map((project, index) =>
      supabase
        .from("projects")
        .update({ sort_order: (index + 1) * 10 })
        .eq("id", project.id)
    );

    const results = await Promise.all(updates);
    const failedUpdate = results.find((result) => result.error);

    if (failedUpdate?.error) {
      console.error("Failed to reorder projects:", failedUpdate.error);
      alert("Failed to reorder projects");
    } else {
      await onDataChanged();
    }
  }

  function handleProjectDragStart(projectId) {
    setDraggedProjectId(projectId);
  }

  async function handleProjectDrop(targetProjectId) {
    await reorderProjects(draggedProjectId, targetProjectId);
    setDraggedProjectId(null);
  }

  function getProjectTitleClass(status) {
    if (status === "CA") return "project-title project-title-ca";
    if (status === "Complete") return "project-title project-title-complete";
    if (status === "On Hold") return "project-title project-title-hold";
    return "project-title project-title-design";
  }

  function getProjectTasks(project) {
    const generalTasks = project.tasks || [];
    const buildingTasks = (project.buildings || []).flatMap(
      (building) => building.tasks || []
    );

    const taskMap = new Map();

    [...generalTasks, ...buildingTasks].forEach((task) => {
      if (task?.id) taskMap.set(task.id, task);
    });

    return Array.from(taskMap.values());
  }

  function getProjectTaskSummary(project) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tasks = getProjectTasks(project).filter((task) => !task.parent_task_id);
    const incompleteTasks = tasks.filter((task) => !task.is_complete);
    const overdueTasks = incompleteTasks.filter((task) => isTaskOverdue(task));

    return {
      total: tasks.length,
      incomplete: incompleteTasks.length,
      overdue: overdueTasks.length,
    };
  }

  function getProjectTasksFromAll(projectList) {
    return (projectList || []).flatMap((project) => getProjectTasks(project));
  }

  async function addTeamMember() {
    if (!newTeamMemberName.trim()) {
      alert("Please enter a team member name.");
      return;
    }

    const { error } = await supabase.from("team_members").insert([
      {
        name: newTeamMemberName.trim(),
      },
    ]);

    if (error) {
      console.error("Failed to add team member:", error);
      alert("Failed to add team member");
    } else {
      setNewTeamMemberName("");
      await onDataChanged();
    }
  }

  function startEditTeamMember(member) {
    setEditingTeamMemberId(member.id);
    setEditingTeamMemberName(member.name || "");
  }

  function cancelEditTeamMember() {
    setEditingTeamMemberId(null);
    setEditingTeamMemberName("");
  }

  async function saveTeamMemberName(member) {
    if (!editingTeamMemberName.trim()) {
      alert("Please enter a team member name.");
      return;
    }

    const { error } = await supabase
      .from("team_members")
      .update({ name: editingTeamMemberName.trim() })
      .eq("id", member.id);

    if (error) {
      console.error("Failed to update team member:", error);
      alert("Failed to update team member");
    } else {
      cancelEditTeamMember();
      await onDataChanged();
    }
  }

  async function deleteTeamMember(member) {
    const assignedTaskCount = getProjectTasksFromAll(projects).filter(
      (task) => task.assigned_to === member.id
    ).length;

    if (assignedTaskCount > 0) {
      alert(`${member.name} still has ${assignedTaskCount} assigned task${assignedTaskCount === 1 ? "" : "s"}. Reassign or clear those tasks first.`);
      return;
    }

    const confirmed = confirm(`Delete team member "${member.name}"?`);
    if (!confirmed) return;

    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("id", member.id);

    if (error) {
      console.error("Failed to delete team member:", error);
      alert("Failed to delete team member");
    } else {
      await onDataChanged();
    }
  }

  async function recordActivity({ projectId, taskId = null, milestoneId = null, action, details = "" }) {
    if (!projectId || !action) return;

    const { error } = await supabase.from("activity_log").insert([
      {
        project_id: projectId,
        task_id: taskId,
        milestone_id: milestoneId,
        action,
        details,
      },
    ]);

    if (error) {
      console.error("Failed to record activity:", error);
    }
  }

  async function updateTaskAssignee(task, assignedTo) {
    const { error } = await supabase
      .from("tasks")
      .update({ assigned_to: assignedTo || null })
      .eq("id", task.id);

    if (error) {
      console.error("Failed to update task assignee:", error);
      alert("Failed to update task assignee");
    } else {
      await onDataChanged();
    }
  }

  function toggleSubtasks(parentTaskId) {
    setCollapsedSubtaskParentIds((current) =>
      current.includes(parentTaskId)
        ? current.filter((id) => id !== parentTaskId)
        : [...current, parentTaskId]
    );
  }

  function toggleMilestonesCollapsed(projectId) {
    setCollapsedMilestoneProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId]
    );
  }

  function toggleBuildingCollapsed(buildingId) {
    setCollapsedBuildingIds((current) =>
      current.includes(buildingId)
        ? current.filter((id) => id !== buildingId)
        : [...current, buildingId]
    );
  }

  function openSubtaskForm(parentTaskId) {
    setSubtaskParentId(parentTaskId);
    setSubtaskLabel("");
  }

  function closeSubtaskForm() {
    setSubtaskParentId(null);
    setSubtaskLabel("");
  }

  function openEditSubtaskForm(subtask) {
    setEditingSubtaskId(subtask.id);
    setEditingSubtaskLabel(subtask.label || "");
  }

  function closeEditSubtaskForm() {
    setEditingSubtaskId(null);
    setEditingSubtaskLabel("");
  }

  async function saveEditedSubtask(subtask) {
    if (!editingSubtaskLabel.trim()) {
      alert("Please enter a subtask name.");
      return;
    }

    const { error } = await supabase
      .from("tasks")
      .update({ label: editingSubtaskLabel.trim() })
      .eq("id", subtask.id);

    if (error) {
      console.error("Failed to update subtask:", error);
      alert("Failed to update subtask");
    } else {
      await recordActivity({
        projectId: subtask.project_id,
        taskId: subtask.id,
        action: "subtask_updated",
        details: `${subtask.label || "Untitled subtask"} → ${editingSubtaskLabel.trim()}`,
      });
      closeEditSubtaskForm();
      await onDataChanged();
    }
  }

  async function saveSubtask(parentTask) {
    if (!subtaskLabel.trim()) {
      alert("Please enter a subtask name.");
      return;
    }

    const { error } = await supabase.from("tasks").insert([
      {
        project_id: parentTask.project_id,
        building_id: parentTask.building_id,
        parent_task_id: parentTask.id,
        label: subtaskLabel.trim(),
        is_complete: false,
      },
    ]);

    if (error) {
      console.error("Failed to save subtask:", error);
      alert("Failed to save subtask");
    } else {
      closeSubtaskForm();
      await onDataChanged();
    }
  }

  async function toggleTaskWaiting(task) {
    const nextIsWaiting = !task.is_waiting;

    const { error } = await supabase
      .from("tasks")
      .update({
        is_waiting: nextIsWaiting,
        waiting_since: nextIsWaiting ? new Date().toISOString() : null,
      })
      .eq("id", task.id);

    if (error) {
      console.error("Failed to update waiting tag:", error);
      alert("Failed to update waiting tag");
    } else {
      await recordActivity({
        projectId: task.project_id,
        taskId: task.id,
        action: nextIsWaiting ? "task_waiting_started" : "task_waiting_cleared",
        details: task.label,
      });

      await onDataChanged();
    }
  }

  async function toggleArchiveProject(project) {
    const nextArchived = !project.is_archived;
    const confirmed = confirm(
      nextArchived
        ? `Archive "${project.title}"? It will be hidden from the active list, but the data stays safe.`
        : `Unarchive "${project.title}"?`
    );

    if (!confirmed) return;

    const { error } = await supabase
      .from("projects")
      .update({ is_archived: nextArchived })
      .eq("id", project.id);

    if (error) {
      console.error("Failed to update project archive status:", error);
      alert("Failed to update project archive status");
    } else {
      await recordActivity({
        projectId: project.id,
        action: nextArchived ? "project_archived" : "project_unarchived",
        details: project.title,
      });

      await onDataChanged();
    }
  }

  function getSelectableProjectTasks() {
    return projects.flatMap((project) =>
      getProjectTasks(project).filter((task) => !task.parent_task_id)
    );
  }

  function getSelectedTasks() {
    const selectedSet = new Set(selectedTaskIds);
    return getSelectableProjectTasks().filter((task) => selectedSet.has(task.id));
  }

  function toggleTaskSelected(taskId) {
    setSelectedTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((id) => id !== taskId)
        : [...current, taskId]
    );
  }

  async function bulkCompleteSelected() {
    const selectedTasks = getSelectedTasks();
    if (selectedTasks.length === 0) return;

    const { error } = await supabase
      .from("tasks")
      .update({ is_complete: true })
      .in("id", selectedTasks.map((task) => task.id));

    if (error) {
      console.error("Failed to complete selected tasks:", error);
      alert("Failed to complete selected tasks");
      return;
    }

    await Promise.all(
      selectedTasks.map((task) =>
        recordActivity({
          projectId: task.project_id,
          taskId: task.id,
          action: "bulk_task_completed",
          details: task.label || "Untitled task",
        })
      )
    );

    setSelectedTaskIds([]);
    await onDataChanged();
  }

  async function bulkAssignSelected() {
    const selectedTasks = getSelectedTasks();
    if (selectedTasks.length === 0) return;
    if (!bulkAssigneeId) {
      alert("Choose a person before assigning selected tasks.");
      return;
    }

    const assignee = teamMembers.find((member) => member.id === bulkAssigneeId);

    const { error } = await supabase
      .from("tasks")
      .update({ assigned_to: bulkAssigneeId })
      .in("id", selectedTasks.map((task) => task.id));

    if (error) {
      console.error("Failed to assign selected tasks:", error);
      alert("Failed to assign selected tasks");
      return;
    }

    await Promise.all(
      selectedTasks.map((task) =>
        recordActivity({
          projectId: task.project_id,
          taskId: task.id,
          action: "bulk_task_assigned",
          details: `${task.label || "Untitled task"} assigned to ${assignee?.name || "Unknown"}`,
        })
      )
    );

    setSelectedTaskIds([]);
    await onDataChanged();
  }

  async function bulkSetWaitingSelected() {
    const selectedTasks = getSelectedTasks();
    if (selectedTasks.length === 0) return;

    const { error } = await supabase
      .from("tasks")
      .update({
        is_waiting: true,
        waiting_since: new Date().toISOString(),
      })
      .in("id", selectedTasks.map((task) => task.id));

    if (error) {
      console.error("Failed to set selected tasks waiting:", error);
      alert("Failed to set selected tasks waiting");
      return;
    }

    await Promise.all(
      selectedTasks.map((task) =>
        recordActivity({
          projectId: task.project_id,
          taskId: task.id,
          action: "bulk_waiting_started",
          details: task.label || "Untitled task",
        })
      )
    );

    setSelectedTaskIds([]);
    await onDataChanged();
  }

  async function bulkClearWaitingSelected() {
    const selectedTasks = getSelectedTasks();
    if (selectedTasks.length === 0) return;

    const { error } = await supabase
      .from("tasks")
      .update({
        is_waiting: false,
        waiting_since: null,
      })
      .in("id", selectedTasks.map((task) => task.id));

    if (error) {
      console.error("Failed to clear waiting from selected tasks:", error);
      alert("Failed to clear waiting from selected tasks");
      return;
    }

    await Promise.all(
      selectedTasks.map((task) =>
        recordActivity({
          projectId: task.project_id,
          taskId: task.id,
          action: "bulk_waiting_cleared",
          details: task.label || "Untitled task",
        })
      )
    );

    setSelectedTaskIds([]);
    await onDataChanged();
  }

  const visibleProjects = projects.filter((project) => {
    const summary = getProjectTaskSummary(project);
    const search = projectSearch.trim().toLowerCase();

    if (search) {
      const searchableText = [
        project.title,
        project.project_number,
        project.client,
        project.architect,
        project.status,
        ...(project.buildings || []).map((building) => building.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!searchableText.includes(search)) {
        return false;
      }
    }

    if (!showArchivedProjects && project.is_archived) {
      return false;
    }

    if (hideCompletedProjects && project.status === "Complete") {
      return false;
    }

    const projectTasks = getProjectTasks(project).filter((task) => !task.parent_task_id);

    if (smartView === "overdue" && summary.overdue === 0) {
      return false;
    }

    if (smartView === "waiting" && !projectTasks.some((task) => !task.is_complete && task.is_waiting)) {
      return false;
    }

    if (smartView === "waitingTooLong" && !projectTasks.some((task) => !task.is_complete && isTaskWaitingTooLong(task))) {
      return false;
    }

    if (smartView === "unassigned" && !projectTasks.some((task) => !task.is_complete && !task.assigned_to)) {
      return false;
    }

    if (showOnlyOverdueProjects && summary.overdue === 0) {
      return false;
    }

    if (assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned") {
        return projectTasks.some((task) => !task.is_complete && !task.assigned_to);
      }

      return projectTasks.some(
        (task) => !task.is_complete && task.assigned_to === assigneeFilter
      );
    }

    return true;
  });

  return (
    <section className="card">
      <div className="section-header">
        <div>
          <h2>Projects</h2>
          <p>Add buildings, then attach milestones to one or more of them.</p>
        </div>
        <button className="primary-button" onClick={addProject}>
          <Plus size={16} /> Project
        </button>
      </div>


      {showProjectForm && (
        <div className="project-create-form">
          <div className="project-create-grid">
            <label>
              Project title
              <input
                value={projectForm.title}
                onChange={(event) => updateProjectForm("title", event.target.value)}
                placeholder="Project name"
              />
            </label>

            <label>
              Project number
              <input
                value={projectForm.project_number}
                onChange={(event) =>
                  updateProjectForm("project_number", event.target.value)
                }
                placeholder="23045"
              />
            </label>

            <label>
              Client
              <input
                value={projectForm.client}
                onChange={(event) => updateProjectForm("client", event.target.value)}
                placeholder="Client name"
              />
            </label>

            <label>
              Architect
              <input
                value={projectForm.architect}
                onChange={(event) =>
                  updateProjectForm("architect", event.target.value)
                }
                placeholder="Architect"
              />
            </label>

            <label>
              Status
              <select
                value={projectForm.status}
                onChange={(event) => updateProjectForm("status", event.target.value)}
              >
                <option value="Design">Design</option>
                <option value="CA">CA</option>
                <option value="Complete">Complete</option>
                <option value="On Hold">On Hold</option>
              </select>
            </label>
          </div>

          <div className="form-actions">
            <button type="button" className="primary-button" onClick={saveNewProject}>
              Save Project
            </button>
            <button type="button" onClick={cancelNewProject}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="project-top-controls">
        <label className="project-search-label">
          Search
          <input
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
            placeholder="Project, client, building..."
          />
        </label>

        <details className="compact-menu project-tools-menu">
          <summary>Project tools</summary>
          <div className="compact-menu-panel project-filter-bar">
            <div className="project-filter-buttons">
              <button type="button" onClick={expandAllProjects}>Expand all</button>
              <button type="button" onClick={collapseAllProjects}>Collapse all</button>
            </div>

            <div className="project-tools-section">
              <span className="project-tools-section-title">Display</span>

              <label className="project-tool-row project-tool-checkbox-row">
                <span>Show completed tasks</span>
                <input
                  type="checkbox"
                  checked={showCompletedTasks}
                  onChange={(event) => setShowCompletedTasks(event.target.checked)}
                />
              </label>

              <label className="project-tool-row project-tool-checkbox-row">
                <span>Hide completed projects</span>
                <input
                  type="checkbox"
                  checked={hideCompletedProjects}
                  onChange={(event) => setHideCompletedProjects(event.target.checked)}
                />
              </label>

              <label className="project-tool-row project-tool-checkbox-row">
                <span>Show archived projects</span>
                <input
                  type="checkbox"
                  checked={showArchivedProjects}
                  onChange={(event) => setShowArchivedProjects(event.target.checked)}
                />
              </label>
            </div>

            <div className="project-tools-section">
              <span className="project-tools-section-title">Filters</span>

              <label className="project-tool-row project-tool-select-row">
                <span>Smart view</span>
                <select value={smartView} onChange={(event) => setSmartView(event.target.value)}>
                  <option value="all">All active projects</option>
                  <option value="overdue">Projects with overdue tasks</option>
                  <option value="waiting">Projects with waiting tasks</option>
                  <option value="waitingTooLong">Waiting too long</option>
                  <option value="unassigned">Projects with unassigned tasks</option>
                </select>
              </label>

              <label className="project-tool-row project-tool-checkbox-row">
                <span>Only projects with overdue tasks</span>
                <input
                  type="checkbox"
                  checked={showOnlyOverdueProjects}
                  onChange={(event) => setShowOnlyOverdueProjects(event.target.checked)}
                />
              </label>

              <label className="project-tool-row project-tool-select-row">
                <span>Assigned to</span>
                <select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
                  <option value="all">Anyone</option>
                  <option value="unassigned">Unassigned</option>
                  {teamMembers.map((member) => (
                    <option value={member.id} key={member.id}>{member.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </details>

        <details className="compact-menu team-menu">
          <summary><Users size={15} /> Team</summary>
          <div className="compact-menu-panel team-manager-panel">
            <div className="team-member-add-row">
              <input value={newTeamMemberName} onChange={(event) => setNewTeamMemberName(event.target.value)} placeholder="Add team member" />
              <button type="button" onClick={addTeamMember}>Add</button>
            </div>

            <div className="team-member-list">
              {teamMembers.length === 0 && <p className="muted-text">No team members yet.</p>}
              {teamMembers.map((member) => (
                <div className="team-member-row" key={member.id}>
                  {editingTeamMemberId === member.id ? (
                    <>
                      <input
                        value={editingTeamMemberName}
                        onChange={(event) => setEditingTeamMemberName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveTeamMemberName(member);
                          if (event.key === "Escape") cancelEditTeamMember();
                        }}
                        autoFocus
                      />
                      <button type="button" onClick={() => saveTeamMemberName(member)}>Save</button>
                      <button type="button" onClick={cancelEditTeamMember}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <strong>{member.name}</strong>
                      <button type="button" onClick={() => startEditTeamMember(member)}>Edit</button>
                      <button type="button" className="danger-button" onClick={() => deleteTeamMember(member)}>Delete</button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </details>

        <span className="project-count-label">{visibleProjects.length} project{visibleProjects.length === 1 ? "" : "s"} shown</span>
      </div>

      {selectedTaskIds.length > 0 && (
        <div className="bulk-action-bar">
          <strong>{selectedTaskIds.length} selected</strong>
          <button type="button" onClick={bulkCompleteSelected}>
            Complete
          </button>
          <select
            value={bulkAssigneeId}
            onChange={(event) => setBulkAssigneeId(event.target.value)}
          >
            <option value="">Assign to...</option>
            {teamMembers.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={bulkAssignSelected}>
            Assign
          </button>
          <button type="button" onClick={bulkSetWaitingSelected}>
            Set Waiting
          </button>
          <button type="button" onClick={bulkClearWaitingSelected}>
            Clear Waiting
          </button>
          <button type="button" onClick={() => setSelectedTaskIds([])}>
            Clear Selection
          </button>
        </div>
      )}

      <div className="project-list">
        {visibleProjects.length === 0 && (
          <div className="empty-state">
            No projects match those filters. Suspiciously tidy.
          </div>
        )}

        {visibleProjects.map((project) => {
          const buildings = project.buildings || [];
          const milestones = project.milestones || [];
          const isCollapsed = collapsedProjectIds.includes(project.id);
          const isMilestonesCollapsed = collapsedMilestoneProjectIds.includes(project.id);
          const taskSummary = getProjectTaskSummary(project);

          return (
            <article
              className={`project-card project-card-stacked ${
                isCollapsed ? "project-collapsed" : ""
              } ${project.is_archived ? "project-archived" : ""} ${draggedProjectId === project.id ? "project-dragging" : ""}`}
              id={`project-${project.id}`}
              key={project.id}
              draggable
              onDragStart={() => handleProjectDragStart(project.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleProjectDrop(project.id)}
              onDragEnd={() => setDraggedProjectId(null)}
            >
              <div className="project-card-top">
                <div className="project-title-block">
                  <button
                    type="button"
                    className="disclosure-button project-disclosure-button"
                    onClick={() => toggleProjectCollapsed(project.id)}
                    aria-label={isCollapsed ? "Expand project" : "Collapse project"}
                    title={isCollapsed ? "Expand project" : "Collapse project"}
                  >
                    {isCollapsed ? "▶" : "▼"}
                  </button>

                  <div>
                    <h3 className={getProjectTitleClass(project.status)}>{project.title}</h3>
                    {project.is_archived && <span className="archived-badge">Archived</span>}
                    <p className="project-number-line">[{project.project_number || "TBD"}]</p>
                    <p>{project.architect}</p>
                    <p>{project.client}</p>
                    <div className="project-summary-badges">
                      <span>{taskSummary.incomplete} open task{taskSummary.incomplete === 1 ? "" : "s"}</span>
                      {taskSummary.overdue > 0 && (
                        <span className="summary-overdue">
                          {taskSummary.overdue} overdue
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="project-actions project-actions-compact">
                  <details className="compact-menu project-card-menu">
                    <summary aria-label="Project actions" title="Project actions">⋯</summary>
                    <div className="compact-menu-panel project-card-menu-panel">
                      <button type="button" onClick={() => addBuilding(project.id)}>
                        <Building2 size={13} /> Building
                      </button>

                      <button type="button" onClick={() => openMilestoneForm(project.id)}>
                        + Milestone
                      </button>

                      <button
                        type="button"
                        className={project.is_archived ? "primary-button" : ""}
                        onClick={() => toggleArchiveProject(project)}
                      >
                        {project.is_archived ? "Unarchive" : "Archive"}
                      </button>
                    </div>
                  </details>

                  <select
                    className={`status-select ${
                      project.status === "CA"
                        ? "status-ca"
                        : project.status === "Complete"
                          ? "status-complete"
                          : project.status === "On Hold"
                            ? "status-hold"
                            : "status-design"
                    }`}
                    value={project.status || "Design"}
                    onChange={(event) => updateProjectStatus(project.id, event.target.value)}
                  >
                    <option value="Design">Design</option>
                    <option value="CA">CA</option>
                    <option value="Complete">Complete</option>
                    <option value="On Hold">On Hold</option>
                  </select>
                </div>
              </div>

              <div className={`project-detail-panel ${isCollapsed ? "collapsed" : ""}`}>
              {milestoneProjectId === project.id && (
                <div className="inline-form">
                  <label>
                    Milestone
                    <input
                      value={milestoneLabel}
                      onChange={(e) => setMilestoneLabel(e.target.value)}
                      placeholder="50% CDs"
                    />
                  </label>

                  <label>
                    Due date
                    <input
                      value={milestoneDate}
                      onChange={(e) => setMilestoneDate(e.target.value)}
                      placeholder="05/15/2026"
                    />
                  </label>

                  <div className="building-picker">
                    <strong>Applies to</strong>
                    {buildings.length === 0 && (
                      <p className="muted-text">General project milestone. No buildings yet.</p>
                    )}

                    {buildings.map((building) => (
                      <label className="checkbox-row" key={building.id}>
                        <input
                          type="checkbox"
                          checked={selectedBuildingIds.includes(building.id)}
                          onChange={() => toggleBuilding(building.id)}
                        />
                        {building.name}
                      </label>
                    ))}
                  </div>

                  <div className="form-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => saveMilestone(project.id)}
                      disabled={savingMilestone}
                    >
                      {savingMilestone
                        ? "Saving..."
                        : editingMilestoneId
                          ? "Update Milestone"
                          : "Save Milestone"}
                    </button>

                    <button type="button" onClick={closeMilestoneForm}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className={`milestone-manager ${isMilestonesCollapsed ? "section-collapsed" : ""}`}>
                <button
                  type="button"
                  className="section-collapse-header"
                  onClick={() => toggleMilestonesCollapsed(project.id)}
                  aria-expanded={!isMilestonesCollapsed}
                >
                  <span className="section-title-wrap">
                    <span className="attention-disclosure-arrow">
                      {isMilestonesCollapsed ? "▶" : "▼"}
                    </span>
                    <h4>Milestones</h4>
                  </span>
                  <span className="section-count-pill">{milestones.length}</span>
                </button>

                {!isMilestonesCollapsed && milestones.length === 0 && (
                  <p className="muted-text">No milestones yet.</p>
                )}

                {!isMilestonesCollapsed && milestones.map((milestone) => {
                  const linkedBuildings =
                    milestone.milestone_buildings
                      ?.map((link) => link.buildings?.name)
                      .filter(Boolean) || [];

                  return (
                    <div className="milestone-row" key={milestone.id}>
                      <div>
                        <strong>{milestone.label}</strong>
                        <span>
                          {milestone.due_date
                            ? format(
                                new Date(`${milestone.due_date}T00:00:00`),
                                "EEE, MMM d, yyyy"
                              )
                            : "No date"}
                          {" · "}
                          {linkedBuildings.length > 0
                            ? linkedBuildings.join(", ")
                            : "General"}
                        </span>
                      </div>

                      <div className="row-actions milestone-row-actions">
                        <details className="compact-menu milestone-actions-menu">
                          <summary aria-label="Milestone actions" title="Milestone actions">⋯</summary>
                          <div className="compact-menu-panel small-actions-menu-panel">
                            <button
                              type="button"
                              onClick={() => openEditMilestoneForm(project.id, milestone)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="danger-button"
                              onClick={() => deleteMilestone(milestone)}
                            >
                              Delete
                            </button>
                          </div>
                        </details>
                      </div>
                    </div>
                  );
                })}
              </div>
                <div className="building-manager">
                <h4>Buildings</h4>

                {buildings.length === 0 && (
                  <p className="muted-text">
                    No buildings yet. Add one before assigning building-specific milestones.
                  </p>
                )}

                <div className="building-chip-list">
                  {(() => {
                    const generalTasks = (project.tasks || []).filter(
                      (task) => !task.building_id && (showCompletedTasks || !task.is_complete)
                    );
                    const completedGeneralTaskCount = generalTasks.filter(
                      (task) => task.is_complete
                    ).length;
                    const generalScopeId = `general-${project.id}`;

                    return (
                      <div className="building-task-card general-task-card">
                        <div className="building-task-header">
                          <div>
                            <strong>General</strong>
                            <span>
                              Project-wide tasks · {generalTasks.length} task
                              {generalTasks.length === 1 ? "" : "s"}
                              {generalTasks.length > 0 &&
                                ` (${completedGeneralTaskCount} done)`}
                            </span>
                          </div>

                          <div className="row-actions">
                            <button
                              type="button"
                              onClick={() => openTaskForm(generalScopeId)}
                            >
                              + Task
                            </button>
                          </div>
                        </div>

                        {taskBuildingId === generalScopeId && (
                          <div className="task-form">
                            <input
                              value={taskLabel}
                              onChange={(event) => setTaskLabel(event.target.value)}
                              placeholder="Add a general project task"
                            />

                            <input
                              type="date"
                              value={taskDueDate}
                              onChange={(event) => setTaskDueDate(event.target.value)}
                            />

                            <select
                              value={taskMilestoneId}
                              onChange={(event) =>
                                setTaskMilestoneId(event.target.value)
                              }
                            >
                              <option value="">No milestone tag</option>
                              {milestones.map((milestone) => (
                                <option value={milestone.id} key={milestone.id}>
                                  {milestone.label}
                                </option>
                              ))}
                            </select>

                            <select
                              value={taskAssigneeId}
                              onChange={(event) =>
                                setTaskAssigneeId(event.target.value)
                              }
                            >
                              <option value="">Unassigned</option>
                              {teamMembers.map((member) => (
                                <option value={member.id} key={member.id}>
                                  {member.name}
                                </option>
                              ))}
                            </select>

                            <textarea
                              value={taskNotes}
                              onChange={(event) => setTaskNotes(event.target.value)}
                              placeholder="Notes, optional"
                            />

                            <button
                              type="button"
                              className="primary-button"
                              onClick={() => saveTask(project.id, null)}
                              disabled={savingTask}
                            >
                              {savingTask
                                ? "Saving..."
                                : editingTaskId
                                  ? "Update Task"
                                  : "Save Task"}
                            </button>
                            <button type="button" onClick={closeTaskForm}>
                              Cancel
                            </button>
                          </div>
                        )}

                        {generalTasks.length > 0 && (
                          <div className="task-list">
                            {generalTasks.filter((task) => !task.parent_task_id).map((task) => (
                              <React.Fragment key={task.id}>
                                <div
                                  className={`task-row ${
                                    task.is_complete ? "task-complete" : ""
                                  } ${!task.is_complete && daysFromToday(task.due_date) < 0 ? "task-overdue" : ""}`}
                                >
                                {(getSortedSubtasks(generalTasks, task.id).length > 0 || subtaskParentId === task.id) ? (
                                  <button
                                    type="button"
                                    className="disclosure-button task-disclosure-button"
                                    onClick={() => toggleSubtasks(task.id)}
                                    aria-label={collapsedSubtaskParentIds.includes(task.id) ? "Show subtasks" : "Hide subtasks"}
                                    title={collapsedSubtaskParentIds.includes(task.id) ? "Show subtasks" : "Hide subtasks"}
                                  >
                                    {collapsedSubtaskParentIds.includes(task.id) ? "▶" : "▼"}
                                  </button>
                                ) : (
                                  <span className="disclosure-spacer" />
                                )}

                                <input
                                  type="checkbox"
                                  className="task-select-checkbox"
                                  checked={selectedTaskIds.includes(task.id)}
                                  onChange={() => toggleTaskSelected(task.id)}
                                  title="Select for bulk actions"
                                />

                                <label>
                                  <input
                                    type="checkbox"
                                    checked={task.is_complete}
                                    onChange={() => toggleTask(task)}
                                  />
                                  <span>{task.label}</span>
                                </label>

                                {task.is_waiting && (
                                  <span className="waiting-badge">Waiting</span>
                                )}

                                {isTaskWaitingTooLong(task) && (
                                  <span className="waiting-stale-badge">
                                    ⚠ Waiting {daysWaiting(task)} days
                                  </span>
                                )}

                                {(() => {
                                  const subtasks = getSortedSubtasks(generalTasks, task.id);
                                  const completed = countCompletedSubtasks(subtasks);

                                  return subtasks.length > 0 ? (
                                    <span className="subtask-progress">
                                      {completed}/{subtasks.length} subtasks
                                    </span>
                                  ) : null;
                                })()}

                                {task.notes && (
                                  <p className="task-notes">{task.notes}</p>
                                )}

                                <div className="task-meta">
                                  <select
                                    className="task-assignee-select"
                                    value={task.assigned_to || ""}
                                    onChange={(event) =>
                                      updateTaskAssignee(task, event.target.value)
                                    }
                                  >
                                    <option value="">Unassigned</option>
                                    {teamMembers.map((member) => (
                                      <option value={member.id} key={member.id}>
                                        {member.name}
                                      </option>
                                    ))}
                                  </select>

                                  {task.due_date && (
                                    <span className="task-due-date">
                                      Due {format(new Date(`${task.due_date}T00:00:00`), "EEE, MMM d")}
                                    </span>
                                  )}

                                  {task.milestones?.label && (
                                    <span className="task-milestone-tag">
                                      {task.milestones.label}
                                    </span>
                                  )}

                                  <details className="task-actions-menu">
                                    <summary aria-label="Task actions">⋯</summary>
                                    <div className="task-actions-menu-panel">
                                      <button type="button" onClick={() => toggleTaskWaiting(task)}>{task.is_waiting ? "Clear Waiting" : "Waiting"}</button>
                                      <button type="button" onClick={() => openSubtaskForm(task.id)}>+ Subtask</button>
                                      <button type="button" onClick={() => openEditTaskForm(generalScopeId, task)}>Edit</button>
                                      <button type="button" className="danger-button" onClick={() => deleteTask(task)}>Delete</button>
                                    </div>
                                  </details>
                                </div>
                              </div>

                              {!collapsedSubtaskParentIds.includes(task.id) && (
                                <div className="subtask-list">
                                  {getSortedSubtasks(generalTasks, task.id).map((subtask) => (
                                      <div
                                        className={`subtask-row ${
                                          subtask.is_complete ? "task-complete" : ""
                                        }`}
                                        key={subtask.id}
                                      >
                                        {editingSubtaskId === subtask.id ? (
                                          <div className="subtask-edit-form">
                                            <input
                                              value={editingSubtaskLabel}
                                              onChange={(event) =>
                                                setEditingSubtaskLabel(event.target.value)
                                              }
                                              onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                  saveEditedSubtask(subtask);
                                                }

                                                if (event.key === "Escape") {
                                                  closeEditSubtaskForm();
                                                }
                                              }}
                                              autoFocus
                                            />
                                            <button
                                              type="button"
                                              className="primary-button"
                                              onClick={() => saveEditedSubtask(subtask)}
                                            >
                                              Save
                                            </button>
                                            <button
                                              type="button"
                                              onClick={closeEditSubtaskForm}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        ) : (
                                          <>
                                            <label>
                                              <input
                                                type="checkbox"
                                                checked={subtask.is_complete}
                                                onChange={() => toggleTask(subtask)}
                                              />
                                              <span>{subtask.label}</span>
                                            </label>

                                            <div className="subtask-actions">
                                              <button
                                                type="button"
                                                onClick={() => openEditSubtaskForm(subtask)}
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                className="danger-button"
                                                onClick={() => deleteTask(subtask)}
                                              >
                                                Delete
                                              </button>
                                            </div>
                                          </>
                                        )}
                                      </div>
                                    ))}

                                  {subtaskParentId === task.id && (
                                    <div className="subtask-form">
                                      <input
                                        value={subtaskLabel}
                                        onChange={(event) =>
                                          setSubtaskLabel(event.target.value)
                                        }
                                        placeholder="Add subtask"
                                      />
                                      <button
                                        type="button"
                                        className="primary-button"
                                        onClick={() => saveSubtask(task)}
                                      >
                                        Save
                                      </button>
                                      <button type="button" onClick={closeSubtaskForm}>
                                        Cancel
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              </React.Fragment>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {buildings.map((building) => {
                      const buildingTasks = (building.tasks || []).filter(
                        (task) => showCompletedTasks || !task.is_complete
                      );
                      const completedTaskCount = buildingTasks.filter(
                        (task) => task.is_complete
                      ).length;
                      const isBuildingCollapsed = collapsedBuildingIds.includes(building.id);

                      return (
                        <div className={`building-task-card ${isBuildingCollapsed ? "section-collapsed" : ""}`} key={building.id}>
                          <div className="building-task-header">
                            <button
                              type="button"
                              className="building-collapse-header building-collapse-grid"
                              onClick={() => toggleBuildingCollapsed(building.id)}
                              aria-expanded={!isBuildingCollapsed}
                            >
                              <span className="building-disclosure-cell" aria-hidden="true">
                                {isBuildingCollapsed ? "▶" : "▼"}
                              </span>
                              <span className="building-title-stack">
                                <strong className="building-section-title">{building.name}</strong>
                                <span className="building-task-count">
                                  {buildingTasks.length} task
                                  {buildingTasks.length === 1 ? "" : "s"}
                                  {buildingTasks.length > 0 &&
                                    ` (${completedTaskCount} done)`}
                                </span>
                              </span>
                            </button>

                            <div className="row-actions building-header-actions">
                              <button
                                type="button"
                                onClick={() => openTaskForm(building.id)}
                              >
                                + Task
                              </button>

                              <details className="compact-menu building-actions-menu">
                                <summary aria-label="Building actions" title="Building actions">⋯</summary>
                                <div className="compact-menu-panel small-actions-menu-panel">
                                  <button
                                    type="button"
                                    onClick={() => editBuilding(building)}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    className="danger-button"
                                    onClick={() => deleteBuilding(building)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </details>
                            </div>
                          </div>

                          {!isBuildingCollapsed && editingBuildingId === building.id && (
                            <div className="building-edit-form">
                              <input
                                value={editingBuildingName}
                                onChange={(event) => setEditingBuildingName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") saveEditedBuilding(building);
                                  if (event.key === "Escape") cancelEditBuilding();
                                }}
                                autoFocus
                              />
                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => saveEditedBuilding(building)}
                              >
                                Save
                              </button>
                              <button type="button" onClick={cancelEditBuilding}>
                                Cancel
                              </button>
                            </div>
                          )}

                          {!isBuildingCollapsed && taskBuildingId === building.id && (
                            <div className="task-form">
                              <input
                                value={taskLabel}
                                onChange={(event) => setTaskLabel(event.target.value)}
                                placeholder="Add a task, like Internal QA"
                              />

                              <input
                                type="date"
                                value={taskDueDate}
                                onChange={(event) => setTaskDueDate(event.target.value)}
                              />

                              <select
                                value={taskMilestoneId}
                                onChange={(event) =>
                                  setTaskMilestoneId(event.target.value)
                                }
                              >
                                <option value="">No milestone tag</option>
                                {milestones.map((milestone) => (
                                  <option value={milestone.id} key={milestone.id}>
                                    {milestone.label}
                                  </option>
                                ))}
                              </select>

                              <select
                                value={taskAssigneeId}
                                onChange={(event) =>
                                  setTaskAssigneeId(event.target.value)
                                }
                              >
                                <option value="">Unassigned</option>
                                {teamMembers.map((member) => (
                                  <option value={member.id} key={member.id}>
                                    {member.name}
                                  </option>
                                ))}
                              </select>

                              <textarea
                                value={taskNotes}
                                onChange={(event) => setTaskNotes(event.target.value)}
                                placeholder="Notes, optional"
                              />

                              <button
                                type="button"
                                className="primary-button"
                                onClick={() => saveTask(project.id, building.id)}
                                disabled={savingTask}
                              >
                                {savingTask
                                ? "Saving..."
                                : editingTaskId
                                  ? "Update Task"
                                  : "Save Task"}
                              </button>
                              <button type="button" onClick={closeTaskForm}>
                                Cancel
                              </button>
                            </div>
                          )}

                          {!isBuildingCollapsed && buildingTasks.length > 0 && (
                            <div className="task-list">
                              {buildingTasks.filter((task) => !task.parent_task_id).map((task) => (
                                <React.Fragment key={task.id}>
                                  <div
                                    className={`task-row ${
                                      task.is_complete ? "task-complete" : ""
                                    } ${!task.is_complete && daysFromToday(task.due_date) < 0 ? "task-overdue" : ""}`}
                                  >
                                  {(getSortedSubtasks(buildingTasks, task.id).length > 0 || subtaskParentId === task.id) ? (
                                    <button
                                      type="button"
                                      className="disclosure-button task-disclosure-button"
                                      onClick={() => toggleSubtasks(task.id)}
                                      aria-label={collapsedSubtaskParentIds.includes(task.id) ? "Show subtasks" : "Hide subtasks"}
                                      title={collapsedSubtaskParentIds.includes(task.id) ? "Show subtasks" : "Hide subtasks"}
                                    >
                                      {collapsedSubtaskParentIds.includes(task.id) ? "▶" : "▼"}
                                    </button>
                                  ) : (
                                    <span className="disclosure-spacer" />
                                  )}

                                  <input
                                    type="checkbox"
                                    className="task-select-checkbox"
                                    checked={selectedTaskIds.includes(task.id)}
                                    onChange={() => toggleTaskSelected(task.id)}
                                    title="Select for bulk actions"
                                  />

                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={task.is_complete}
                                      onChange={() => toggleTask(task)}
                                    />
                                    <span>{task.label}</span>
                                  </label>

                                  {task.is_waiting && (
                                    <span className="waiting-badge">Waiting</span>
                                  )}

                                  {isTaskWaitingTooLong(task) && (
                                    <span className="waiting-stale-badge">
                                      ⚠ Waiting {daysWaiting(task)} days
                                    </span>
                                  )}

                                  {(() => {
                                    const subtasks = getSortedSubtasks(buildingTasks, task.id);
                                    const completed = countCompletedSubtasks(subtasks);

                                    return subtasks.length > 0 ? (
                                      <span className="subtask-progress">
                                        {completed}/{subtasks.length} subtasks
                                      </span>
                                    ) : null;
                                  })()}

                                  {task.notes && (
                                    <p className="task-notes">{task.notes}</p>
                                  )}

                                  <div className="task-meta">
                                    <select
                                      className="task-assignee-select"
                                      value={task.assigned_to || ""}
                                      onChange={(event) =>
                                        updateTaskAssignee(task, event.target.value)
                                      }
                                    >
                                      <option value="">Unassigned</option>
                                      {teamMembers.map((member) => (
                                        <option value={member.id} key={member.id}>
                                          {member.name}
                                        </option>
                                      ))}
                                    </select>

                                    {task.due_date && (
                                      <span className="task-due-date">
                                        Due {format(new Date(`${task.due_date}T00:00:00`), "EEE, MMM d")}
                                      </span>
                                    )}

                                    {task.milestones?.label && (
                                      <span className="task-milestone-tag">
                                        {task.milestones.label}
                                      </span>
                                    )}

                                    <details className="task-actions-menu">
                                      <summary aria-label="Task actions">⋯</summary>
                                      <div className="task-actions-menu-panel">
                                        <button type="button" onClick={() => toggleTaskWaiting(task)}>{task.is_waiting ? "Clear Waiting" : "Waiting"}</button>
                                        <button type="button" onClick={() => openSubtaskForm(task.id)}>+ Subtask</button>
                                        <button type="button" onClick={() => openEditTaskForm(building.id, task)}>Edit</button>
                                        <button type="button" className="danger-button" onClick={() => deleteTask(task)}>Delete</button>
                                      </div>
                                    </details>
                                  </div>
                                </div>

                                {!collapsedSubtaskParentIds.includes(task.id) && (
                                  <div className="subtask-list">
                                    {getSortedSubtasks(buildingTasks, task.id).map((subtask) => (
                                        <div
                                          className={`subtask-row ${
                                            subtask.is_complete ? "task-complete" : ""
                                          }`}
                                          key={subtask.id}
                                        >
                                          {editingSubtaskId === subtask.id ? (
                                            <div className="subtask-edit-form">
                                              <input
                                                value={editingSubtaskLabel}
                                                onChange={(event) =>
                                                  setEditingSubtaskLabel(event.target.value)
                                                }
                                                onKeyDown={(event) => {
                                                  if (event.key === "Enter") {
                                                    saveEditedSubtask(subtask);
                                                  }

                                                  if (event.key === "Escape") {
                                                    closeEditSubtaskForm();
                                                  }
                                                }}
                                                autoFocus
                                              />
                                              <button
                                                type="button"
                                                className="primary-button"
                                                onClick={() => saveEditedSubtask(subtask)}
                                              >
                                                Save
                                              </button>
                                              <button
                                                type="button"
                                                onClick={closeEditSubtaskForm}
                                              >
                                                Cancel
                                              </button>
                                            </div>
                                          ) : (
                                            <>
                                              <label>
                                                <input
                                                  type="checkbox"
                                                  checked={subtask.is_complete}
                                                  onChange={() => toggleTask(subtask)}
                                                />
                                                <span>{subtask.label}</span>
                                              </label>

                                              <div className="subtask-actions">
                                                <button
                                                  type="button"
                                                  onClick={() => openEditSubtaskForm(subtask)}
                                                >
                                                  Edit
                                                </button>
                                                <button
                                                  type="button"
                                                  className="danger-button"
                                                  onClick={() => deleteTask(subtask)}
                                                >
                                                  Delete
                                                </button>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      ))}

                                    {subtaskParentId === task.id && (
                                      <div className="subtask-form">
                                        <input
                                          value={subtaskLabel}
                                          onChange={(event) =>
                                            setSubtaskLabel(event.target.value)
                                          }
                                          placeholder="Add subtask"
                                        />
                                        <button
                                          type="button"
                                          className="primary-button"
                                          onClick={() => saveSubtask(task)}
                                        >
                                          Save
                                        </button>
                                        <button type="button" onClick={closeSubtaskForm}>
                                          Cancel
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                                </React.Fragment>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
              </div>


              <ActivityPanel
                logs={activityLogs.filter((item) => item.project_id === project.id)}
              />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProjectQuickView({ project, events, onClose, onManage }) {
  if (!project) return null;

  const projectEvents = events
    .filter((event) => event.project_id === project.id)
    .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="project-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-header">
          <div>
            <h2>{project.title}</h2>
            <p>
              {project.project_number} · {project.client} · {project.architect}
            </p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="deadline-list">
          {projectEvents.length === 0 && (
            <p>No deadlines found for this project yet.</p>
          )}

          {projectEvents.map((event) => {
            const buildings = normalizeBuildings(
              event.buildings || event.building_names
            );

            return (
              <div
              className="deadline-row clickable-row"
              key={event.id}
              onClick={() => onJumpToProject(event.project_id)}
            >
                <div>
                  <strong>{event.label}</strong>
                  <span>
                    {buildings.length > 0 ? buildings.join(", ") : "General"}
                  </span>
                </div>
                <div className="deadline-date">
                  {event.due_date
                    ? format(new Date(`${event.due_date}T00:00:00`), "EEE, MMM d")
                    : "No date"}
                </div>
              </div>
            );
          })}
        </div>

        <div className="form-actions">
          <button type="button" className="primary-button" onClick={onManage}>
            Manage in Projects
          </button>
        </div>
      </section>
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [events, setEvents] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [activityLogs, setActivityLogs] = useState([]);

  async function loadProjects() {
    setLoadingProjects(true);

    const { data, error } = await supabase
      .from("projects")
      .select(`
        *,
        tasks (
          *,
          milestones (*)
        ),
        buildings (
          *,
          tasks (
            *,
            milestones (*)
          )
        ),
        milestones (
          *,
          milestone_buildings (
            building_id,
            buildings (*)
          )
        )
      `)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading projects:", error);
    } else {
      const sortedProjects = (data || []).map((project) => ({
        ...project,
        tasks: [...(project.tasks || [])].sort((a, b) =>
          (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") ||
          (a.created_at || "").localeCompare(b.created_at || "")
        ),
        buildings: [...(project.buildings || [])]
          .map((building) => ({
            ...building,
            tasks: [...(building.tasks || [])].sort((a, b) =>
              (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") ||
              (a.created_at || "").localeCompare(b.created_at || "")
            ),
          }))
          .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
        milestones: [...(project.milestones || [])].sort((a, b) =>
          (a.due_date || "").localeCompare(b.due_date || "")
        ),
      }));

      setProjects(sortedProjects);
    }

    setLoadingProjects(false);
  }

  async function loadEvents() {
    const { data, error } = await supabase
      .from("calendar_items")
      .select("*")
      .order("due_date", { ascending: true });

    if (error) {
      console.error("Error loading events:", error);
    } else {
      setEvents(data || []);
    }
  }

  async function loadTeamMembers() {
    const { data, error } = await supabase
      .from("team_members")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      console.error("Error loading team members:", error);
    } else {
      setTeamMembers(data || []);
    }
  }

  async function loadActivityLogs() {
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);

    if (error) {
      console.error("Error loading activity log:", error);
      setActivityLogs([]);
    } else {
      setActivityLogs(data || []);
    }
  }

  async function refreshData() {
    await Promise.all([loadProjects(), loadEvents(), loadTeamMembers(), loadActivityLogs()]);
  }

  useEffect(() => {
    refreshData();
  }, []);

  const [activeTab, setActiveTab] = useState("dashboard");
  const [toggles, setToggles] = useState({
    designMilestones: true,
    tasks: false,
    caDeadlines: true,
  });

  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState(null);

  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) || null;

  function handleCalendarEventClick(event) {
    setSelectedProjectId(event.project_id);
  }

  function jumpToProject(projectId, taskId = null) {
    setSelectedProjectId(null);
    setHighlightedTaskId(taskId);
    setActiveTab("projects");

    window.setTimeout(() => {
      const projectElement = document.getElementById(`project-${projectId}`);
      if (projectElement) {
        projectElement.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
  }

  function manageSelectedProject() {
    setSelectedProjectId(null);
    setActiveTab("projects");
  }

  const content = useMemo(() => {
    if (activeTab === "calendar") {
      return (
        <CalendarMonth
          events={events}
          toggles={toggles}
          onEventClick={handleCalendarEventClick}
        />
      );
    }

    if (activeTab === "projects") {
      return loadingProjects ? (
        <section className="card">Loading projects...</section>
      ) : (
        <Projects
          projects={projects}
          teamMembers={teamMembers}
          activityLogs={activityLogs}
          highlightedTaskId={highlightedTaskId}
          onDataChanged={refreshData}
        />
      );
    }

    if (activeTab === "notifications") {
      return (
        <section className="card">
          <h2>Notifications</h2>
          <p>Pending milestone approvals, task assignments, and deadline nudges will live here.</p>
        </section>
      );
    }

    return (
      <Dashboard
        events={events}
        projects={projects}
        teamMembers={teamMembers}
        onJumpToProject={jumpToProject}
        onDataChanged={refreshData}
      />
    );
  }, [activeTab, toggles, events, projects, teamMembers, activityLogs, loadingProjects]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>Project Deadline Tracker</h1>
          <p>Lean project deadlines, milestones, tasks, and CA tracking.</p>
        </div>
      </header>

      {activeTab === "calendar" && (
        <section className="toggle-card">
          <label>
            <input
              type="checkbox"
              checked={toggles.designMilestones}
              onChange={(e) =>
                setToggles({ ...toggles, designMilestones: e.target.checked })
              }
            />
            Design milestones
          </label>

          <label>
            <input
              type="checkbox"
              checked={toggles.tasks}
              onChange={(e) => setToggles({ ...toggles, tasks: e.target.checked })}
            />
            Tasks
          </label>

          <label>
            <input
              type="checkbox"
              checked={toggles.caDeadlines}
              onChange={(e) =>
                setToggles({ ...toggles, caDeadlines: e.target.checked })
              }
            />
            CA deadlines
          </label>
        </section>
      )}

      {content}

      <ProjectQuickView
        project={selectedProject}
        events={events}
        onClose={() => setSelectedProjectId(null)}
        onManage={manageSelectedProject}
      />

      <nav className="bottom-nav">
        <button
          className={activeTab === "dashboard" ? "active" : ""}
          onClick={() => setActiveTab("dashboard")}
        >
          <ClipboardList size={18} />
          Dashboard
        </button>

        <button
          className={activeTab === "calendar" ? "active" : ""}
          onClick={() => setActiveTab("calendar")}
        >
          <CalendarDays size={18} />
          Calendar
        </button>

        <button
          className={activeTab === "projects" ? "active" : ""}
          onClick={() => setActiveTab("projects")}
        >
          <FolderKanban size={18} />
          Projects
        </button>

        <button
          className={activeTab === "notifications" ? "active" : ""}
          onClick={() => setActiveTab("notifications")}
        >
          <Bell size={18} />
          Alerts
        </button>
      </nav>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
