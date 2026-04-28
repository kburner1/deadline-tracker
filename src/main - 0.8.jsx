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

function TaskAttentionList({ title, tasks, emptyText, onCompleteTask = () => {}, onJumpToProject = () => {} }) {
  return (
    <div className="attention-panel">
      <div className="attention-panel-header">
        <h3>{title}</h3>
        <span>{tasks.length}</span>
      </div>

      {tasks.length === 0 ? (
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

function Projects({ projects, teamMembers = [], onDataChanged }) {
  const [milestoneProjectId, setMilestoneProjectId] = useState(null);
  const [milestoneLabel, setMilestoneLabel] = useState("");
  const [milestoneDate, setMilestoneDate] = useState("");
  const [selectedBuildingIds, setSelectedBuildingIds] = useState([]);
  const [savingMilestone, setSavingMilestone] = useState(false);
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
  const [collapsedProjectIds, setCollapsedProjectIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("deadlineTrackerCollapsedProjects") || "[]");
    } catch {
      return [];
    }
  });
  const [showCompletedTasks, setShowCompletedTasks] = useState(true);
  const [hideCompletedProjects, setHideCompletedProjects] = useState(false);
  const [showOnlyOverdueProjects, setShowOnlyOverdueProjects] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [projectSearch, setProjectSearch] = useState("");
  const [newTeamMemberName, setNewTeamMemberName] = useState("");
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

  async function editBuilding(building) {
    const name = prompt("Building name?", building.name);
    if (!name?.trim()) return;

    const { error } = await supabase
      .from("buildings")
      .update({ name: name.trim() })
      .eq("id", building.id);

    if (error) {
      console.error("Failed to update building:", error);
      alert("Failed to update building");
    } else {
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
      closeTaskForm();
      await onDataChanged();
    }

    setSavingTask(false);
  }

  async function toggleTask(task) {
    const { error } = await supabase
      .from("tasks")
      .update({ is_complete: !task.is_complete })
      .eq("id", task.id);

    if (error) {
      console.error("Failed to update task:", error);
      alert("Failed to update task");
    } else {
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
    const { error } = await supabase
      .from("tasks")
      .update({ is_waiting: !task.is_waiting })
      .eq("id", task.id);

    if (error) {
      console.error("Failed to update waiting tag:", error);
      alert("Failed to update waiting tag");
    } else {
      await onDataChanged();
    }
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

    if (hideCompletedProjects && project.status === "Complete") {
      return false;
    }

    if (showOnlyOverdueProjects && summary.overdue === 0) {
      return false;
    }

    if (assigneeFilter !== "all") {
      const tasks = getProjectTasks(project).filter((task) => !task.parent_task_id);

      if (assigneeFilter === "unassigned") {
        return tasks.some((task) => !task.is_complete && !task.assigned_to);
      }

      return tasks.some(
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

      <div className="task-filter-bar">
        <label>
          <input
            type="checkbox"
            checked={showCompletedTasks}
            onChange={(event) => setShowCompletedTasks(event.target.checked)}
          />
          Show completed tasks
        </label>
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

      <div className="project-filter-bar">
        <label className="project-search-label">
          Search
          <input
            value={projectSearch}
            onChange={(event) => setProjectSearch(event.target.value)}
            placeholder="Project, client, building..."
          />
        </label>

        <div className="project-filter-buttons">
          <button type="button" onClick={expandAllProjects}>
            Expand all
          </button>
          <button type="button" onClick={collapseAllProjects}>
            Collapse all
          </button>
        </div>

        <label>
          <input
            type="checkbox"
            checked={hideCompletedProjects}
            onChange={(event) => setHideCompletedProjects(event.target.checked)}
          />
          Hide completed projects
        </label>

        <label>
          <input
            type="checkbox"
            checked={showOnlyOverdueProjects}
            onChange={(event) => setShowOnlyOverdueProjects(event.target.checked)}
          />
          Show only projects with overdue tasks
        </label>

        <label>
          Assigned to
          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
          >
            <option value="all">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {teamMembers.map((member) => (
              <option value={member.id} key={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>

        <span>{visibleProjects.length} project{visibleProjects.length === 1 ? "" : "s"} shown</span>
      </div>

      <div className="team-member-bar">
        <Users size={16} />
        <input
          value={newTeamMemberName}
          onChange={(event) => setNewTeamMemberName(event.target.value)}
          placeholder="Add team member"
        />
        <button type="button" onClick={addTeamMember}>
          Add Person
        </button>
      </div>

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
          const taskSummary = getProjectTaskSummary(project);

          return (
            <article
              className={`project-card project-card-stacked ${
                isCollapsed ? "project-collapsed" : ""
              } ${draggedProjectId === project.id ? "project-dragging" : ""}`}
              id={`project-${project.id}`}
              key={project.id}
              draggable
              onDragStart={() => handleProjectDragStart(project.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => handleProjectDrop(project.id)}
              onDragEnd={() => setDraggedProjectId(null)}
            >
              <div className="project-card-top">
                <div>
                  <h3 className={getProjectTitleClass(project.status)}>{project.title}</h3>
                  <p>
                    {project.project_number} · {project.client}
                  </p>
                  <p>{project.architect}</p>
                  <div className="project-summary-badges">
                    <span>{taskSummary.incomplete} open task{taskSummary.incomplete === 1 ? "" : "s"}</span>
                    {taskSummary.overdue > 0 && (
                      <span className="summary-overdue">
                        {taskSummary.overdue} overdue
                      </span>
                    )}
                  </div>
                </div>

                <div className="project-actions">
                  <span className="drag-handle" title="Drag to reorder">↕</span>

                  <button
                    type="button"
                    className="collapse-button"
                    onClick={() => toggleProjectCollapsed(project.id)}
                  >
                    {isCollapsed ? "Expand" : "Collapse"}
                  </button>

                  <button type="button" onClick={() => addBuilding(project.id)}>
                    <Building2 size={15} /> Building
                  </button>

                  <button type="button" onClick={() => openMilestoneForm(project.id)}>
                    + Milestone
                  </button>

                  <label className="status-select-wrap">
                    Status
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
                      onChange={(event) =>
                        updateProjectStatus(project.id, event.target.value)
                      }
                    >
                      <option value="Design">Design</option>
                      <option value="CA">CA</option>
                      <option value="Complete">Complete</option>
                      <option value="On Hold">On Hold</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className={`project-detail-panel ${isCollapsed ? "collapsed" : ""}`}>
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

                                  <button
                                    type="button"
                                    onClick={() => toggleTaskWaiting(task)}
                                  >
                                    {task.is_waiting ? "Clear Waiting" : "Waiting"}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => openSubtaskForm(task.id)}
                                  >
                                    + Subtask
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => toggleSubtasks(task.id)}
                                  >
                                    {collapsedSubtaskParentIds.includes(task.id)
                                      ? "Show Subtasks"
                                      : "Hide Subtasks"}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => openEditTaskForm(generalScopeId, task)}
                                  >
                                    Edit
                                  </button>

                                  <button
                                    type="button"
                                    className="danger-button"
                                    onClick={() => deleteTask(task)}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>

                              {!collapsedSubtaskParentIds.includes(task.id) && (
                                <div className="subtask-list">
                                  {(generalTasks || [])
                                    .filter((subtask) => subtask.parent_task_id === task.id)
                                    .map((subtask) => (
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

                      return (
                        <div className="building-task-card" key={building.id}>
                          <div className="building-task-header">
                            <div>
                              <strong>{building.name}</strong>
                              <span>
                                {buildingTasks.length} task
                                {buildingTasks.length === 1 ? "" : "s"}
                                {buildingTasks.length > 0 &&
                                  ` (${completedTaskCount} done)`}
                              </span>
                            </div>

                            <div className="row-actions">
                              <button
                                type="button"
                                onClick={() => openTaskForm(building.id)}
                              >
                                + Task
                              </button>
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
                          </div>

                          {taskBuildingId === building.id && (
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

                          {buildingTasks.length > 0 && (
                            <div className="task-list">
                              {buildingTasks.filter((task) => !task.parent_task_id).map((task) => (
                                <React.Fragment key={task.id}>
                                  <div
                                    className={`task-row ${
                                      task.is_complete ? "task-complete" : ""
                                    } ${!task.is_complete && daysFromToday(task.due_date) < 0 ? "task-overdue" : ""}`}
                                  >
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

                                    <button
                                      type="button"
                                      onClick={() => toggleTaskWaiting(task)}
                                    >
                                      {task.is_waiting ? "Clear Waiting" : "Waiting"}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => openSubtaskForm(task.id)}
                                    >
                                      + Subtask
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => toggleSubtasks(task.id)}
                                    >
                                      {collapsedSubtaskParentIds.includes(task.id)
                                        ? "Show Subtasks"
                                        : "Hide Subtasks"}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => openEditTaskForm(building.id, task)}
                                    >
                                      Edit
                                    </button>

                                    <button
                                      type="button"
                                      className="danger-button"
                                      onClick={() => deleteTask(task)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>

                                {!collapsedSubtaskParentIds.includes(task.id) && (
                                  <div className="subtask-list">
                                    {(buildingTasks || [])
                                      .filter((subtask) => subtask.parent_task_id === task.id)
                                      .map((subtask) => (
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

              <div className="milestone-manager">
                <h4>Milestones</h4>

                {milestones.length === 0 && (
                  <p className="muted-text">No milestones yet.</p>
                )}

                {milestones.map((milestone) => {
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

                      <div className="row-actions">
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
                    </div>
                  );
                })}
              </div>
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

  async function refreshData() {
    await Promise.all([loadProjects(), loadEvents(), loadTeamMembers()]);
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
  }, [activeTab, toggles, events, projects, teamMembers, loadingProjects]);

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
